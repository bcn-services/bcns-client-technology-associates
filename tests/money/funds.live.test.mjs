/**
 * Browser check of /funds/new → real createFundsAction (dev server at BASE_URL, default http://localhost:3100).
 * Skips when unreachable or Supabase is unconfigured. Creates invented case 990901 (a copy of case 90001's
 * tblcase row); after() removes every tblfundsrcvd row for 990901 and the case itself.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { chromium } from "@playwright/test";
import { loadEnvLocal } from "../app-shell/seed-e2e.ts";
import { createServerClient } from "../../lib/db/client.ts";
import { firmToday } from "../../lib/cases/presets.ts";

loadEnvLocal();
const BASE = process.env.BASE_URL ?? "http://localhost:3100";
const EMAIL = process.env.E2E_EMAIL ?? "staff@example.test";
const up = await fetch(`${BASE}/login`).then((r) => r.ok, () => false);
const skip = up && process.env.SUPABASE_SERVICE_ROLE_KEY ? false : "dev server or Supabase unavailable";
const CASE = 990901, NOCASE = 990999;
let db, browser, page;
const ok = ({ data, error }) => { if (error) throw new Error(error.message); return data; };
const rowsFor = async (c) => ok(await db.from("tblfundsrcvd").select("fndsid, fndspmt, fndsbranch, fndscaseid, fndspayee").eq("fndscaseid", c));
const cleanup = async () => {
  ok(await db.from("tblfundsrcvd").delete().in("fndscaseid", [CASE, NOCASE]));
  ok(await db.from("tblcase").delete().eq("caseid", CASE));
};

async function submit({ caseId = String(CASE), amount }) {
  await page.goto("/funds/new");
  await page.getByLabel(/^Case/).fill(caseId);
  await page.getByLabel(/^Amount/).fill(amount);
  await page.getByLabel(/^Payee/).fill("QA Live Payee");
  await page.getByRole("button", { name: "Record funds" }).click();
}

before(async () => {
  if (skip) return;
  db = createServerClient();
  await cleanup();
  assert.equal(ok(await db.from("tblcase").select("caseid").eq("caseid", NOCASE)).length, 0, "990999 must not exist");
  const src = ok(await db.from("tblcase").select("*").eq("caseid", 90001).single());
  ok(await db.from("tblcase").insert({ ...src, caseid: CASE }));
  browser = await chromium.launch();
  page = await browser.newPage({ baseURL: BASE });
  for (let i = 0; ; i++) { // shared project → auth 429s; back off
    await page.goto("/login");
    await page.getByLabel(/email/i).fill(EMAIL);
    await page.getByLabel(/password/i).fill(process.env.E2E_PASSWORD ?? "password");
    await page.getByRole("button", { name: /sign in/i }).click();
    try { await page.waitForURL((u) => u.pathname !== "/login", { timeout: 20_000 }); break; } catch (e) { if (i >= 4) throw e; await page.waitForTimeout(3000 * (i + 1)); }
  }
});
after(async () => {
  await browser?.close();
  if (db) await cleanup();
});

for (const amount of ["45.001", "abc"]) {
  test(`amount ${amount} → amount field error on screen, zero rows for case ${CASE}`, { skip }, async () => {
    await submit({ amount });
    await page.waitForURL(/\/funds\/new\?error=amount/);
    const alert = page.getByRole("alert").filter({ hasText: "Amount must be" });
    await alert.waitFor();
    assert.equal(await page.getByLabel(/^Amount/).getAttribute("aria-invalid"), "true");
    assert.equal((await rowsFor(CASE)).length, 0);
  });
}

test(`nonexistent case ${NOCASE} → case field error on screen, zero rows`, { skip }, async () => {
  await submit({ caseId: String(NOCASE), amount: "450.00" });
  await page.waitForURL(/\/funds\/new\?error=case/);
  await page.getByRole("alert").filter({ hasText: "No case with that number" }).waitFor();
  assert.equal(await page.getByLabel(/^Case/).getAttribute("aria-invalid"), "true");
  assert.equal((await rowsFor(NOCASE)).length, 0);
  assert.equal((await rowsFor(CASE)).length, 0);
});

test(`case ${CASE}, 450.00 → one row (fndspmt 450.00, Stratford) and "Funds recorded"`, { skip }, async () => {
  await submit({ amount: "450.00" });
  await page.waitForURL(/\/funds\/\d+\?saved=1/);
  await page.getByText("Funds recorded").waitFor();
  const rows = await rowsFor(CASE);
  assert.equal(rows.length, 1);
  assert.equal(Number(rows[0].fndspmt).toFixed(2), "450.00");
  assert.equal(rows[0].fndsbranch, "Stratford");
  assert.ok(page.url().includes(`/funds/${rows[0].fndsid}?`));
  await page.goto("/funds");
  const firstLink = page.getByRole("link", { name: /^\d{4}-\d{2}-\d{2}$/ }).first();
  assert.equal(await firstLink.getAttribute("href"), `/funds/${rows[0].fndsid}`, "newest row listed first");
});

test(`/funds/new?case=${CASE} prefills case; date defaults to firmToday; branch defaults Stratford`, { skip }, async () => {
  await page.goto(`/funds/new?case=${CASE}`);
  assert.equal(await page.getByLabel(/^Case/).inputValue(), String(CASE));
  assert.equal(await page.getByLabel(/^Date$/).inputValue(), firmToday(new Date()));
  assert.equal(await page.getByLabel(/^Branch/).inputValue(), "Stratford");
});

test("edit on /funds/[id]?saved=1 (same-URL redirect): form re-renders server-normalized values, row updated", { skip }, async () => {
  const [row] = await rowsFor(CASE);
  assert.ok(row, "needs the row from the 450.00 test");
  await page.goto(`/funds/${row.fndsid}?saved=1`);
  await page.getByLabel(/^Amount/).fill("12.5"); // server normalizes → "12.50"; a stale uncontrolled input would keep "12.5"
  await page.getByLabel(/^Payee/).fill("  QA Edited Payee  "); // server trims
  const posted = page.waitForResponse((r) => r.request().method() === "POST", { timeout: 60_000 });
  await page.getByRole("button", { name: "Save" }).click();
  await posted;
  await page.waitForLoadState("networkidle");
  const [after] = await rowsFor(CASE);
  assert.equal(Number(after.fndspmt).toFixed(2), "12.50", "row updated: fndspmt");
  assert.equal(after.fndspayee, "QA Edited Payee", "row updated: fndspayee");
  const amt = await page.getByLabel(/^Amount/).inputValue();
  const payee = await page.getByLabel(/^Payee/).inputValue();
  assert.equal(amt, "12.50", `form re-rendered server amount (url ${page.url()})`);
  assert.equal(payee, "QA Edited Payee", "form re-rendered server payee");
  assert.equal(await page.getByRole("status").filter({ hasText: "Funds recorded" }).count(), 1);
});
