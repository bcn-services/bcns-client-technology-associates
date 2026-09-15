/**
 * Live check of the case-page money panels through the real dev server (BASE_URL, default http://localhost:3100) and
 * the hosted DB, as the seeded staff login. Skips without the server or SUPABASE_SERVICE_ROLE_KEY. Invented case
 * 990901 (panel rows) and decoy case 990902 (one row each that must NOT appear); each case is created from case
 * 90001's row only if absent, and removed only if this file created it. after() deletes inserted rows by exact id.
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
const CASE = 990901, DECOY = 990902;
let db, browser, page;
const created = [], fndsIds = [], expIds = [];
const ok = ({ data, error }) => { if (error) throw new Error(error.message); return data; };
const addFnd = async (o) => { const id = ok(await db.from("tblfundsrcvd").insert({ fndsdate: "2026-09-01", fndsbranch: "Stratford", fndstype: "Retainer", fndsclearedbank: false, ...o }).select("fndsid").single()).fndsid; fndsIds.push(id); return id; };
const addExp = async (o) => { expIds.push(ok(await db.from("tblexpenses").insert({ expdate: "2026-09-02", expchecknum: 0, expbranch: "Stratford", expclearedbank: false, ...o }).select("expid").single()).expid); };

before(async () => {
  if (skip) return;
  db = createServerClient();
  const src = ok(await db.from("tblcase").select("*").eq("caseid", 90001).single());
  for (const caseid of [CASE, DECOY]) {
    if (!ok(await db.from("tblcase").select("caseid").eq("caseid", caseid).maybeSingle())) { ok(await db.from("tblcase").insert({ ...src, caseid })); created.push(caseid); }
  }
  await addFnd({ fndscaseid: CASE, fndspmt: "0.10", fndspayee: `QA f1 ${RUN}`, fndsclearedbank: true });
  await addFnd({ fndscaseid: CASE, fndspmt: "0.20", fndspayee: `QA f2 ${RUN}` });
  const orig = await addFnd({ fndscaseid: CASE, fndspmt: "125.00", fndspayee: `QA f3 ${RUN}` });
  ok(await db.from("tblfundsrcvd").insert({ fndsid: -orig, fndscaseid: CASE, fndsdate: "2026-09-03", fndsbranch: "Stratford", fndstype: "Bounced", fndspmt: "-125.00", fndspayee: `QA f3 ${RUN}`, fndsclearedbank: false }));
  fndsIds.push(-orig);
  await addFnd({ fndscaseid: DECOY, fndspmt: "777.77", fndspayee: `QA decoy ${RUN}` });
  await addExp({ expcaseid: CASE, expamount: "0.10", expdscr: `QA e1 ${RUN}`, expclearedbank: true });
  await addExp({ expcaseid: CASE, expamount: "0.20", expdscr: `QA e2 ${RUN}` });
  await addExp({ expcaseid: DECOY, expamount: "666.66", expdscr: `QA decoy ${RUN}` });
  browser = await chromium.launch();
  page = await (await browser.newContext({ baseURL: BASE })).newPage();
  page.setDefaultTimeout(60_000); // first signed-in /cases/<id> render compiles the page on a fresh dev server
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
  if (fndsIds.length) ok(await db.from("tblfundsrcvd").delete().in("fndsid", fndsIds));
  if (expIds.length) ok(await db.from("tblexpenses").delete().in("expid", expIds));
  if (created.length) ok(await db.from("tblcase").delete().in("caseid", created));
});

const region = async (name) => {
  await page.goto(`/cases/${CASE}`);
  const r = page.getByRole("region", { name });
  await r.waitFor({ timeout: 30_000 });
  return r;
};

test("/cases/990901 'Funds received' lists its rows incl. the reversal, nets to 0.30, decoy case absent", { skip }, async () => {
  const r = await region("Funds received");
  const t = await r.innerText();
  for (const k of ["f1", "f2", "f3"]) assert.ok(t.includes(`QA ${k} ${RUN}`), `${k} listed: ${t}`);
  assert.equal(t.split(`QA f3 ${RUN}`).length - 1, 2, "original and reversal both listed");
  assert.ok(!t.includes(`QA decoy ${RUN}`), "decoy case row absent");
  assert.ok(/Bounced/.test(t) && t.includes("-125.00"));
  assert.equal((await r.getByTestId("funds-total").innerText()).trim(), "0.30");
  const row = r.getByRole("row").filter({ hasText: `QA f1 ${RUN}` });
  assert.ok((await row.innerText()).includes("Cleared"));
});

test("/cases/990901 'Expenses' lists its rows, totals 0.30, decoy case absent", { skip }, async () => {
  const r = await region("Expenses");
  const t = await r.innerText();
  for (const k of ["e1", "e2"]) assert.ok(t.includes(`QA ${k} ${RUN}`), `${k} listed: ${t}`);
  assert.ok(!t.includes(`QA decoy ${RUN}`), "decoy case row absent");
  assert.equal((await r.getByTestId("expenses-total").innerText()).trim(), "0.30");
  assert.ok(!(await r.getByRole("row").filter({ hasText: `QA e2 ${RUN}` }).innerText()).includes("Cleared"));
});

test("'Add funds' opens /funds/new with case 990901 prefilled", { skip }, async () => {
  await (await region("Funds received")).getByRole("link", { name: "Add funds" }).click();
  await page.waitForURL(/\/funds\/new\?case=990901$/);
  assert.equal(await page.getByLabel("Case").inputValue(), String(CASE));
});

test("'Add expense' opens /expenses/new with case 990901 prefilled", { skip }, async () => {
  await (await region("Expenses")).getByRole("link", { name: "Add expense" }).click();
  await page.waitForURL(/\/expenses\/new\?case=990901$/);
  assert.equal(await page.getByLabel("Case (blank = firm-wide)").inputValue(), String(CASE));
});
