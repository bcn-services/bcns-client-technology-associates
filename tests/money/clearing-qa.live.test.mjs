/**
 * QA live gaps for /bank-review/accounts through the real dev server (BASE_URL, default :3100) + hosted DB, as the
 * seeded staff login: staff clearing actually writes, a mixed X+Y forged submit clears only X, the partial-failure and
 * clearerror banners render with the form intact. Invented per-run accounts; after() deletes by those exact values.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { chromium } from "@playwright/test";
import { loadEnvLocal } from "../app-shell/seed-e2e.ts";
import { createServerClient } from "../../lib/db/client.ts";

loadEnvLocal();
const BASE = process.env.BASE_URL ?? "http://localhost:3100";
const up = await fetch(`${BASE}/login`).then((r) => r.ok, () => false);
const skip = up && process.env.SUPABASE_SERVICE_ROLE_KEY ? false : "dev server or Supabase unavailable";
const RUN = randomUUID().slice(0, 8);
const X = `QA2 Clear X ${RUN}`, Y = `QA2 Clear Y ${RUN}`;
let db, browser, page;
const ids = {};
const ok = ({ data, error }) => { if (error) throw new Error(error.message); return data; };
const addExp = async (k, acct, o = {}) => { ids[k] = ok(await db.from("tblexpenses").insert({ expdate: "2026-01-10", expdscr: `QA2 ${k} ${RUN}`, expchecknum: 0, expamount: "1.11", expbranch: "Stratford", expbankaccount: acct, expclearedbank: false, expclearingnotes: "keep", ...o }).select("expid").single()).expid; };
const addFnd = async (k, acct, o = {}) => { ids[k] = ok(await db.from("tblfundsrcvd").insert({ fndsdate: "2026-01-11", fndspmt: "2.22", fndsbranch: "Stratford", fndspayee: `QA2 ${k} ${RUN}`, fndsdesc: "ck", fndsbankaccount: acct, fndsclearingnotes: "keep", ...o }).select("fndsid").single()).fndsid; };
const exp = async (k) => ok(await db.from("tblexpenses").select("*").eq("expid", ids[k]).single());
const fnd = async (k) => ok(await db.from("tblfundsrcvd").select("*").eq("fndsid", ids[k]).single());

before(async () => {
  if (skip) return;
  db = createServerClient();
  await addExp("e1", X); await addExp("eY", Y);
  await addFnd("f1", X); await addFnd("fY", Y);
  browser = await chromium.launch();
  page = await (await browser.newContext({ baseURL: BASE })).newPage();
  for (let i = 0; ; i++) {
    await page.goto("/login");
    await page.getByLabel(/email/i).fill(process.env.E2E_EMAIL ?? "staff@example.test");
    await page.getByLabel(/password/i).fill(process.env.E2E_PASSWORD ?? "password");
    await page.getByRole("button", { name: /sign in/i }).click();
    try { await page.waitForURL((u) => u.pathname !== "/login", { timeout: 20_000 }); break; } catch (e) { if (i >= 4) throw e; await page.waitForTimeout(3000 * (i + 1)); }
  }
});
after(async () => {
  await browser?.close();
  if (!db) return;
  ok(await db.from("tblexpenses").delete().in("expbankaccount", [X, Y]));
  ok(await db.from("tblfundsrcvd").delete().in("fndsbankaccount", [X, Y]));
});

const open = async (qs = {}) => { await page.goto(`/bank-review/accounts?${new URLSearchParams({ account: X, ...qs })}`); await page.getByRole("heading", { name: "Clear by bank account" }).waitFor(); };
const listed = async () => (await page.getByRole("table").innerText()).split("\n").filter((l) => l.includes(RUN));

test("banners: clearfailed=funds names funds as NOT cleared; clearerror=date shows error and keeps the form + rows", { skip }, async () => {
  await open({ cleared: "1", skipped: "0", clearfailed: "funds" });
  assert.match(await page.getByTestId("clear-failed-funds").innerText(), /funds rows were NOT cleared/);
  assert.equal(await page.getByTestId("clear-failed-expenses").count(), 0);
  await open({ clearerror: "date" });
  assert.match(await page.getByTestId("clear-error").innerText(), /real cleared date/);
  assert.equal((await listed()).length, 2);
  assert.ok(await page.getByRole("button", { name: "Mark cleared" }).isVisible());
});

test("staff: X rows + forged Y ids, empty note → only X rows cleared (date 2026-02-01, notes kept); Y untouched", { skip }, async () => {
  await open();
  await page.getByLabel(`Select Expense ${ids.e1} QA2 e1 ${RUN}`).check();
  await page.getByLabel(new RegExp(`^Select Funds ${ids.f1} QA2 f1 ${RUN}`)).check();
  await page.getByRole("form", { name: "Mark cleared" }).evaluate((form, [eY, fY]) => {
    for (const [n, v] of [["exp", eY], ["fnd", fY]]) {
      const i = document.createElement("input");
      Object.assign(i, { type: "hidden", name: n, value: String(v) });
      form.appendChild(i);
    }
  }, [ids.eY, ids.fY]);
  await page.getByLabel("Cleared date").fill("2026-02-01");
  await page.getByRole("button", { name: "Mark cleared" }).click();
  await page.waitForURL(/[?&](cleared|clearerror)=/);
  assert.equal(await page.getByTestId("clear-result").innerText(), "Cleared 2 rows.");
  assert.match(await page.getByTestId("clear-skipped").innerText(), /^2 selected rows were not cleared/);
  const [e1, f1, eY, fY] = [await exp("e1"), await fnd("f1"), await exp("eY"), await fnd("fY")];
  assert.deepEqual([e1.expclearedbank, e1.expdatecleared, e1.expclearingnotes], [true, "2026-02-01", "keep"]);
  assert.deepEqual([f1.fndsclearedbank, f1.fndsdatecleared, f1.fndsclearingnotes], [true, "2026-02-01", "keep"]);
  assert.notEqual(eY.expclearedbank, true); assert.equal(eY.expdatecleared, null);
  assert.notEqual(fY.fndsclearedbank, true); assert.equal(fY.fndsdatecleared, null);
  assert.equal(await page.getByRole("table").count(), 0, "list empty after clearing both X rows");
  assert.equal(await page.getByLabel("Cleared date").inputValue() !== "", true);
});
