/**
 * Live check of /bank-review/accounts (clearing view by bank account) through the real dev server (BASE_URL, default
 * http://localhost:3100) and the hosted DB. Staff (seeded E2E login) and a throwaway admin. Skips without the server or
 * SUPABASE_SERVICE_ROLE_KEY. Invented per-run bank accounts X / Y; rows carry no case. after() deletes every
 * tblexpenses / tblfundsrcvd row on those two accounts and the throwaway admin.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { chromium } from "@playwright/test";
import { loadEnvLocal, seedE2eUser } from "../app-shell/seed-e2e.ts";
import { createServerClient } from "../../lib/db/client.ts";

loadEnvLocal();
const BASE = process.env.BASE_URL ?? "http://localhost:3100";
const up = await fetch(`${BASE}/login`).then((r) => r.ok, () => false);
const skip = up && process.env.SUPABASE_SERVICE_ROLE_KEY ? false : "dev server or Supabase unavailable";
const RUN = randomUUID().slice(0, 8);
const X = `QA Clear X ${RUN}`, Y = `QA Clear Y ${RUN}`;
const ADMIN_EMAIL = `clear-admin-${RUN}@example.test`, ADMIN_PASSWORD = `pw-${randomUUID()}`;
let db, browser, staff, admin, adminId;
const ids = {};
const ok = ({ data, error }) => { if (error) throw new Error(error.message); return data; };
const addExp = async (k, acct, o = {}) => { ids[k] = ok(await db.from("tblexpenses").insert({ expdate: "2026-01-10", expdscr: `QA ${k} ${RUN}`, expchecknum: 0, expamount: "12.34", expbranch: "Stratford", expbankaccount: acct, expclearedbank: false, ...o }).select("expid").single()).expid; };
const addFnd = async (k, acct, o = {}) => { ids[k] = ok(await db.from("tblfundsrcvd").insert({ fndsdate: "2026-01-11", fndspmt: "56.78", fndsbranch: "Stratford", fndspayee: `QA ${k} ${RUN}`, fndsdesc: "ck", fndsbankaccount: acct, ...o }).select("fndsid").single()).fndsid; };
const exp = async (k) => ok(await db.from("tblexpenses").select("*").eq("expid", ids[k]).single());
const fnd = async (k) => ok(await db.from("tblfundsrcvd").select("*").eq("fndsid", ids[k]).single());

async function signIn(email, password) {
  const page = await (await browser.newContext({ baseURL: BASE })).newPage();
  for (let i = 0; ; i++) {
    await page.goto("/login");
    await page.getByLabel(/email/i).fill(email);
    await page.getByLabel(/password/i).fill(password);
    await page.getByRole("button", { name: /sign in/i }).click();
    try { await page.waitForURL((u) => u.pathname !== "/login", { timeout: 20_000 }); break; } catch (e) { if (i >= 4) throw e; await page.waitForTimeout(3000 * (i + 1)); }
  }
  return page;
}

before(async () => {
  if (skip) return;
  db = createServerClient();
  await addExp("e1", X); await addExp("e2", X); await addExp("eDone", X, { expclearedbank: true, expdatecleared: "2025-01-01" });
  await addExp("eY", Y);
  await addFnd("f1", X); await addFnd("f2", X, { fndsclearedbank: null }); await addFnd("fY", Y);
  adminId = (await seedE2eUser(db, ADMIN_EMAIL, ADMIN_PASSWORD)).id;
  ok(await db.from("profiles").update({ role: "admin", personid: 2 }).eq("id", adminId));
  browser = await chromium.launch();
  staff = await signIn(process.env.E2E_EMAIL ?? "staff@example.test", process.env.E2E_PASSWORD ?? "password");
  admin = await signIn(ADMIN_EMAIL, ADMIN_PASSWORD);
});
after(async () => {
  await browser?.close();
  if (!db) return;
  ok(await db.from("tblexpenses").delete().in("expbankaccount", [X, Y]));
  ok(await db.from("tblfundsrcvd").delete().in("fndsbankaccount", [X, Y]));
  if (adminId) { await db.from("profiles").delete().eq("id", adminId); await db.auth.admin.deleteUser(adminId); }
});

const open = async (page) => { await page.goto(`/bank-review/accounts?${new URLSearchParams({ account: X })}`); await page.getByRole("heading", { name: "Clear by bank account" }).waitFor(); };
const listed = async (page) => (await page.getByRole("table").innerText()).split("\n").filter((l) => l.includes(RUN));

test("?account=X lists only uncleared expenses and funds on X (staff)", { skip }, async () => {
  await open(staff);
  const rows = await listed(staff);
  for (const k of ["e1", "e2", "f1", "f2"]) assert.ok(rows.some((l) => l.includes(`QA ${k} ${RUN}`)), `${k} listed: ${rows.join(" | ")}`);
  for (const k of ["eDone", "eY", "fY"]) assert.ok(!rows.some((l) => l.includes(`QA ${k} ${RUN}`)), `${k} not listed`);
  assert.equal(rows.length, 4, rows.join(" | "));
  assert.ok((await staff.getByLabel("Bank account").locator("option").allInnerTexts()).includes(X));
});

test("admin: Mark cleared 2026-02-01 on two rows clears exactly those; they leave the list", { skip }, async () => {
  await open(admin);
  await admin.getByLabel(`Select Expense ${ids.e1} QA e1 ${RUN}`).check();
  await admin.getByLabel(new RegExp(`^Select Funds ${ids.f1} QA f1 ${RUN}`)).check();
  await admin.getByLabel("Cleared date").fill("2026-02-01");
  await admin.getByLabel("Clearing note (optional)").fill("feb stmt");
  await admin.getByRole("button", { name: "Mark cleared" }).click();
  await admin.waitForURL(/[?&](cleared|clearerror)=/);
  assert.equal(await admin.getByTestId("clear-result").innerText(), "Cleared 2 rows.");
  const [e1, f1] = [await exp("e1"), await fnd("f1")];
  assert.deepEqual([e1.expclearedbank, e1.expdatecleared, e1.expclearingnotes], [true, "2026-02-01", "feb stmt"]);
  assert.deepEqual([f1.fndsclearedbank, f1.fndsdatecleared, f1.fndsclearingnotes], [true, "2026-02-01", "feb stmt"]);
  for (const k of ["e2", "eY"]) assert.notEqual((await exp(k)).expclearedbank, true, k);
  for (const k of ["f2", "fY"]) assert.notEqual((await fnd(k)).fndsclearedbank, true, k);
  assert.equal((await exp("eDone")).expdatecleared, "2025-01-01");
  const rows = await listed(admin);
  assert.deepEqual(rows.map((l) => l.match(/QA (\w+) /)[1]).sort(), ["e2", "f2"]);
});

test("forged submit: account-Y rows' ids posted with account X selected are not updated (staff)", { skip }, async () => {
  await open(staff);
  await staff.getByRole("form", { name: "Mark cleared" }).evaluate((form, [eY, fY]) => {
    for (const [n, v] of [["exp", eY], ["fnd", fY]]) {
      const i = document.createElement("input");
      Object.assign(i, { type: "hidden", name: n, value: String(v) });
      form.appendChild(i);
    }
  }, [ids.eY, ids.fY]);
  await staff.getByLabel("Cleared date").fill("2026-02-01");
  await staff.getByRole("button", { name: "Mark cleared" }).click();
  await staff.waitForURL(/[?&](cleared|clearerror)=/);
  assert.equal(await staff.getByTestId("clear-result").innerText(), "Cleared 0 rows.");
  assert.match(await staff.getByTestId("clear-skipped").innerText(), /^2 selected rows were not cleared/);
  const [eY, fY] = [await exp("eY"), await fnd("fY")];
  assert.deepEqual([eY.expclearedbank, eY.expdatecleared], [false, null]);
  assert.notEqual(fY.fndsclearedbank, true); // DB default is false; either way uncleared
  assert.equal(fY.fndsdatecleared, null);
});
