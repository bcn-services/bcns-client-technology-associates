/**
 * Live check of /expenses/new and /expenses/[id] through the real page + server action (dev server at
 * BASE_URL, default http://localhost:3101). Skips when unreachable or Supabase is unconfigured.
 * No case rows are created: the firm-wide and edit rows have expcaseid null, the bad case is 999999999.
 * Every tblexpenses row this file creates carries a per-run description and is deleted by exact expid /
 * description in after(). audit_log rows are left (the tests/time live pattern does not delete them).
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { chromium } from "@playwright/test";
import { loadEnvLocal } from "../app-shell/seed-e2e.ts";
import { createServerClient } from "../../lib/db/client.ts";

loadEnvLocal();
const BASE = process.env.BASE_URL ?? "http://localhost:3101";
const EMAIL = process.env.E2E_EMAIL ?? "staff@example.test";
const up = await fetch(`${BASE}/login`).then((r) => r.ok, () => false);
const skip = up && process.env.SUPABASE_SERVICE_ROLE_KEY ? false : "dev server or Supabase unavailable";
const RUN = `QA-exp-${randomUUID().slice(0, 8)}`;
const D = { firm: `${RUN} firm-wide`, badcase: `${RUN} bad case`, edit: `${RUN} edit` };
let db, browser, page, ids = [];
const ok = ({ data, error }) => { if (error) throw new Error(error.message); return data; };
const byDscr = async (dscr) => ok(await db.from("tblexpenses").select("*").eq("expdscr", dscr));

async function signIn(email, password) {
  const ctx = await browser.newContext({ baseURL: BASE });
  const p = await ctx.newPage();
  for (let i = 0; ; i++) { // shared project → auth 429s; back off
    await p.goto("/login");
    await p.getByLabel(/email/i).fill(email);
    await p.getByLabel(/password/i).fill(password);
    await p.getByRole("button", { name: /sign in/i }).click();
    try { await p.waitForURL((u) => u.pathname !== "/login", { timeout: 20_000 }); break; } catch (e) { if (i >= 4) throw e; await p.waitForTimeout(3000 * (i + 1)); }
  }
  return p;
}

/** Fill the shared form by label and submit it. */
async function fill(fields) {
  if (fields.date) await page.getByLabel("Date", { exact: true }).fill(fields.date);
  if (fields.checknum != null) await page.getByLabel("Check number", { exact: true }).fill(fields.checknum);
  if (fields.dscr) await page.getByLabel("Description").fill(fields.dscr);
  if (fields.amount) await page.getByLabel("Amount").fill(fields.amount);
  if (fields.case != null) await page.getByLabel(/^Case/).fill(fields.case);
  await page.getByRole("button", { name: "Save expense" }).click();
}

before(async () => {
  if (skip) return;
  db = createServerClient();
  for (const p of ["/login", "/api/health", "/expenses/new"]) await fetch(`${BASE}${p}`).catch(() => {});
  browser = await chromium.launch();
  page = await signIn(EMAIL, process.env.E2E_PASSWORD ?? "password");
});
after(async () => {
  await browser?.close();
  if (!db) return;
  for (const d of Object.values(D)) ok(await db.from("tblexpenses").delete().eq("expdscr", d));
  if (ids.length) ok(await db.from("tblexpenses").delete().in("expid", ids));
});

test("new with no case → saved, tblexpenses row has expcaseid null (firm-wide), branch Stratford", { skip }, async () => {
  await page.goto("/expenses/new");
  await fill({ checknum: "0", dscr: D.firm, amount: "12.34" });
  await page.waitForURL((u) => /^\/expenses\/\d+$/.test(u.pathname) && u.searchParams.get("saved") === "1");
  const id = Number(new URL(page.url()).pathname.split("/").pop());
  ids.push(id);
  const rows = await byDscr(D.firm);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].expid, id);
  assert.equal(rows[0].expcaseid, null);
  assert.equal(Number(rows[0].expamount), 12.34);
  assert.equal(rows[0].expbranch, "Stratford");
});

test("case 999999999 → case field error on the page, no tblexpenses row with that description", { skip }, async () => {
  await page.goto("/expenses/new");
  await fill({ checknum: "5", dscr: D.badcase, amount: "9.99", case: "999999999" });
  await page.waitForURL((u) => u.pathname === "/expenses/new" && u.searchParams.get("error") === "case");
  await page.getByText("No case with that number.").waitFor();
  assert.equal(await page.getByLabel(/^Case/).getAttribute("aria-invalid"), "true");
  assert.equal(await page.getByLabel(/^Case/).inputValue(), "999999999");
  assert.deepEqual(await byDscr(D.badcase), []);
});

test("edit amount 45.00 → 50.00 persists 50.00, expid unchanged, audit_log UPDATE old 45 / new 50", { skip }, async () => {
  const id = ok(await db.from("tblexpenses").insert({ expdate: "2026-09-14", expdscr: D.edit, expchecknum: 0, expamount: 45, expbranch: "Stratford" }).select("expid").single()).expid;
  ids.push(id);
  const since = ok(await db.from("audit_log").select("id").order("id", { ascending: false }).limit(1))[0]?.id ?? 0;
  await page.goto(`/expenses/${id}`);
  assert.equal(await page.getByLabel("Amount").inputValue(), "45.00");
  await fill({ amount: "50.00" });
  await page.waitForURL((u) => u.pathname === `/expenses/${id}` && u.searchParams.get("saved") === "1");
  await page.getByText("Saved.").waitFor();
  const rows = await byDscr(D.edit);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].expid, id);
  assert.equal(Number(rows[0].expamount), 50);
  const audit = ok(await db.from("audit_log").select("op, olddata, newdata").eq("tablename", "tblexpenses").eq("rowid", String(id)).gt("id", since));
  const upd = audit.filter((r) => r.op === "UPDATE");
  assert.equal(upd.length, 1, JSON.stringify(audit));
  assert.equal(Number(upd[0].olddata.expamount), 45);
  assert.equal(Number(upd[0].newdata.expamount), 50);
  assert.equal(upd[0].newdata.expid, id);
});

test("new page: date defaults to firm today, branch Stratford, retired type absent from Type select, ?case= prefills", { skip }, async () => {
  const types = ok(await db.from("tblexptype").select("exptype, active"));
  await page.goto("/expenses/new?case=90001");
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date());
  assert.equal(await page.getByLabel("Date", { exact: true }).inputValue(), today);
  assert.equal(await page.getByLabel("Branch").inputValue(), "Stratford");
  assert.equal(await page.getByLabel(/^Case/).inputValue(), "90001");
  const opts = await page.getByLabel("Type").locator("option").allTextContents();
  for (const t of types) assert.equal(opts.includes(t.exptype), t.active === true, `${t.exptype} (active=${t.active}) in ${JSON.stringify(opts)}`);
});

test("unknown id → 404", { skip }, async () => {
  const res = await page.goto("/expenses/999999999");
  assert.equal(res.status(), 404);
});
