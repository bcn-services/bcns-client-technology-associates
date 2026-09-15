/**
 * Live check of "Mark bill paid" / "Record partial payment" on /funds/[id] through the real dev server (BASE_URL,
 * default http://localhost:3100) and the real payBillAction. Skips without the server or SUPABASE_SERVICE_ROLE_KEY.
 * Invented cases 990900 (bills + funds) and 990902 (funds, no bills), copies of case 90001's tblcase row. after()
 * deletes every tblbills / tblfundsrcvd / tblcase row on those two case numbers, and the throwaway admin.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { chromium } from "@playwright/test";
import { loadEnvLocal, seedE2eUser } from "../app-shell/seed-e2e.ts";
import { createServerClient } from "../../lib/db/client.ts";

loadEnvLocal();
const BASE = process.env.BASE_URL ?? "http://localhost:3100";
const EMAIL = process.env.E2E_EMAIL ?? "staff@example.test";
const ADMIN_EMAIL = `funds-pay-admin-${randomUUID().slice(0, 8)}@example.test`;
const ADMIN_PASSWORD = `pw-${randomUUID()}`;
const up = await fetch(`${BASE}/login`).then((r) => r.ok, () => false);
const skip = up && process.env.SUPABASE_SERVICE_ROLE_KEY ? false : "dev server or Supabase unavailable";
const CASE = 990900, EMPTY = 990902, CASES = [CASE, EMPTY];
const FUNDS_DATE = "2026-08-02";
let db, browser, staff, admin, adminId, fundsId, emptyFundsId;
const ok = ({ data, error }) => { if (error) throw new Error(error.message); return data; };
const cleanup = async () => {
  ok(await db.from("tblfundsrcvd").delete().in("fndscaseid", CASES)); // before bills: fndsbillid → tblbills FK
  ok(await db.from("tblbills").delete().in("billcaseid", CASES));
  ok(await db.from("tblcase").delete().in("caseid", CASES));
};
const addBill = async (o) => ok(await db.from("tblbills").insert({ billcaseid: CASE, billdate: "2026-08-14", billhours: 2, billbalance: 640, billtype: "timesheet", billnotice: "1st", ...o }).select("billid").single()).billid;
const bill = async (id) => ok(await db.from("tblbills").select("*").eq("billid", id).single());
const addFunds = async (c) => ok(await db.from("tblfundsrcvd").insert({ fndscaseid: c, fndsdate: FUNDS_DATE, fndspmt: "450.00", fndsbranch: "Stratford", fndspayee: "QA Live Payee" }).select("fndsid").single()).fndsid;
const unpaid = async (page) => { await page.goto(`/cases/${CASE}`); return Number(await page.getByTestId("unpaid-bill-count").innerText()); };
const select = (page) => page.getByLabel("Bill", { exact: true });

async function signIn(email, password) {
  const ctx = await browser.newContext({ baseURL: BASE });
  const page = await ctx.newPage();
  for (let i = 0; ; i++) { // shared project → auth 429s; back off
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
  await cleanup();
  const src = ok(await db.from("tblcase").select("*").eq("caseid", 90001).single());
  ok(await db.from("tblcase").insert(CASES.map((caseid) => ({ ...src, caseid }))));
  fundsId = await addFunds(CASE);
  emptyFundsId = await addFunds(EMPTY);
  adminId = (await seedE2eUser(db, ADMIN_EMAIL, ADMIN_PASSWORD)).id;
  ok(await db.from("profiles").update({ role: "admin", personid: 2 }).eq("id", adminId));
  browser = await chromium.launch();
  staff = await signIn(EMAIL, process.env.E2E_PASSWORD ?? "password");
  admin = await signIn(ADMIN_EMAIL, ADMIN_PASSWORD);
});
after(async () => {
  await browser?.close();
  if (!db) return;
  await cleanup();
  if (adminId) { await db.from("profiles").delete().eq("id", adminId); await db.auth.admin.deleteUser(adminId); }
});

test("oldest open bill preselected; ?bill= preselects; Mark bill paid → Paid + funds date, notice dates kept, unpaid −1, gone from /bills", { skip }, async () => {
  const older = await addBill({ billdate: "2026-06-01" });
  const target = await addBill({ billdate: "2026-08-14", billsecondnoticedate: "2026-07-15" });
  await admin.goto(`/funds/${fundsId}`);
  assert.equal(await select(admin).inputValue(), `${older}:1st`, "oldest open bill preselected");
  const before = await unpaid(admin);
  await admin.goto(`/funds/${fundsId}?bill=${target}`);
  assert.equal(await select(admin).inputValue(), `${target}:1st`);
  await admin.getByRole("button", { name: "Mark bill paid" }).click();
  await admin.waitForURL(new RegExp(`/funds/${fundsId}\\?paid=${target}`));
  await admin.getByTestId("pay-saved").waitFor();
  const b = await bill(target);
  assert.equal(b.billnotice, "Paid");
  assert.equal(b.billpaiddate, FUNDS_DATE);
  assert.equal(b.billsecondnoticedate, "2026-07-15");
  assert.equal(b.billfinalnoticedate, null);
  assert.equal((await bill(older)).billnotice, "1st", "other bill untouched");
  assert.equal(ok(await db.from("tblfundsrcvd").select("fndsbillid").eq("fndsid", fundsId).single()).fndsbillid, target, "funds row linked");
  assert.equal((await admin.getByTestId("applied-bill").innerText()).trim(), `Applied to bill ${target}`);
  assert.equal(await unpaid(admin), before - 1);
  await admin.goto("/bills");
  assert.equal(await admin.locator(`a[href="/bills/${target}"]`).count(), 0, "paid bill gone from /bills");
  assert.equal(await admin.locator(`a[href="/bills/${older}"]`).count() > 0, true, "open bill still listed");
});

test("Record partial payment → 'Partial Payment', unpaid count unchanged", { skip }, async () => {
  const id = await addBill({ billdate: "2026-01-02" }); // oldest → preselected
  const fid = await addFunds(CASE); // fundsId is linked by the first test
  const before = await unpaid(admin);
  await admin.goto(`/funds/${fid}`);
  assert.equal(await select(admin).inputValue(), `${id}:1st`);
  await admin.getByRole("button", { name: "Record partial payment" }).click();
  await admin.waitForURL(new RegExp(`\\?paid=${id}`));
  const b = await bill(id);
  assert.equal(b.billnotice, "Partial Payment");
  assert.equal(b.billpaiddate, null);
  assert.equal(await unpaid(admin), before);
});

test("notice changed after page load → not written, stale-bill error shown", { skip }, async () => {
  const id = await addBill({ billdate: "2026-08-20" });
  const fid = await addFunds(CASE);
  await admin.goto(`/funds/${fid}?bill=${id}`);
  assert.equal(await select(admin).inputValue(), `${id}:1st`);
  ok(await db.from("tblbills").update({ billnotice: "2nd", billsecondnoticedate: "2026-09-01" }).eq("billid", id));
  await admin.getByRole("button", { name: "Mark bill paid" }).click();
  await admin.waitForURL(/payerror=stale/);
  await admin.getByTestId("pay-error").filter({ hasText: "This bill changed meanwhile" }).waitFor();
  const b = await bill(id);
  assert.equal(b.billnotice, "2nd");
  assert.equal(b.billpaiddate, null);
  assert.equal(ok(await db.from("tblfundsrcvd").select("fndsbillid").eq("fndsid", fid).single()).fndsbillid, null, "link compensated");
});

test("no open bills → 'No open bills on this case', no pay buttons", { skip }, async () => {
  await admin.goto(`/funds/${emptyFundsId}`);
  await admin.getByText("No open bills on this case").waitFor();
  assert.equal(await admin.getByRole("button", { name: "Mark bill paid" }).count(), 0);
});

test("staff: no Bill payment controls rendered", { skip }, async () => {
  await addBill({ billdate: "2026-08-21" });
  await staff.goto(`/funds/${fundsId}`);
  await staff.getByRole("heading", { name: /^Funds #/ }).waitFor();
  assert.equal(await staff.getByRole("region", { name: "Bill payment" }).count(), 0);
  assert.equal(await staff.getByRole("button", { name: "Mark bill paid" }).count(), 0);
});

test("staff POST through the real pay action (admin-rendered form, staff cookies) → forbidden, bill unchanged", { skip }, async () => {
  const id = await addBill({ billdate: "2026-08-22" });
  const fid = await addFunds(CASE);
  const ctx = await browser.newContext({ baseURL: BASE });
  const page = await ctx.newPage();
  await ctx.addCookies(await admin.context().cookies());
  await page.goto(`/funds/${fid}?bill=${id}`);
  assert.equal(await select(page).inputValue(), `${id}:1st`);
  await ctx.clearCookies();
  await ctx.addCookies(await staff.context().cookies());
  await page.getByRole("button", { name: "Mark bill paid" }).click();
  await page.waitForURL(/payerror=forbidden/);
  await page.getByTestId("pay-error").or(page.getByRole("heading", { name: /^Funds #/ })).first().waitFor();
  const b = await bill(id);
  assert.equal(b.billnotice, "1st");
  assert.equal(b.billpaiddate, null);
  await ctx.close();
});
