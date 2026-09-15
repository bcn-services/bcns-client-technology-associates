/**
 * Live check of the bills panel's paid date and "Record payment" link → /funds/new → /funds/[id] bill preselect,
 * through the real dev server (BASE_URL, default http://localhost:3100) as admin and staff. Skips without the server
 * or SUPABASE_SERVICE_ROLE_KEY. Invented case 990920 (two open bills, one Paid bill) and foreign case 990921 (one
 * open bill), copies of case 90001's tblcase row. after() deletes every tblbills / tblfundsrcvd / tblcase row on
 * those two case numbers, and the throwaway admin.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { chromium } from "@playwright/test";
import { loadEnvLocal, seedE2eUser } from "../app-shell/seed-e2e.ts";
import { createServerClient } from "../../lib/db/client.ts";

loadEnvLocal();
const BASE = process.env.BASE_URL ?? "http://localhost:3100";
const ADMIN_EMAIL = `bill-link-admin-${randomUUID().slice(0, 8)}@example.test`;
const ADMIN_PASSWORD = `pw-${randomUUID()}`;
const up = await fetch(`${BASE}/login`).then((r) => r.ok, () => false);
const skip = up && process.env.SUPABASE_SERVICE_ROLE_KEY ? false : "dev server or Supabase unavailable";
const CASE = 990920, FOREIGN = 990921, CASES = [CASE, FOREIGN];
const PAID_DATE = "2026-07-03";
let db, browser, staff, admin, adminId, oldest, newer, paid, foreign;
const ok = ({ data, error }) => { if (error) throw new Error(error.message); return data; };
const cleanup = async () => {
  ok(await db.from("tblbills").delete().in("billcaseid", CASES));
  ok(await db.from("tblfundsrcvd").delete().in("fndscaseid", CASES));
  ok(await db.from("tblcase").delete().in("caseid", CASES));
};
const addBill = async (o) => ok(await db.from("tblbills").insert({ billcaseid: CASE, billhours: 2, billbalance: 640, billtype: "timesheet", billnotice: "1st", ...o }).select("billid").single()).billid;
const select = (page) => page.getByLabel("Bill", { exact: true });

async function signIn(email, password) {
  const ctx = await browser.newContext({ baseURL: BASE });
  const page = await ctx.newPage();
  page.setDefaultTimeout(60_000);
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
  oldest = await addBill({ billdate: "2026-05-01" });
  newer = await addBill({ billdate: "2026-08-10", billnotice: "2nd", billsecondnoticedate: "2026-09-01" });
  paid = await addBill({ billdate: "2026-06-15", billnotice: "Paid", billpaiddate: PAID_DATE });
  foreign = await addBill({ billcaseid: FOREIGN, billdate: "2026-04-01" }); // older than `oldest`: a leaked case filter would preselect it
  adminId = (await seedE2eUser(db, ADMIN_EMAIL, ADMIN_PASSWORD)).id;
  ok(await db.from("profiles").update({ role: "admin", personid: 2 }).eq("id", adminId));
  browser = await chromium.launch();
  staff = await signIn(process.env.E2E_EMAIL ?? "staff@example.test", process.env.E2E_PASSWORD ?? "password");
  admin = await signIn(ADMIN_EMAIL, ADMIN_PASSWORD);
});
after(async () => {
  await browser?.close();
  if (!db) return;
  await cleanup();
  if (adminId) { await db.from("profiles").delete().eq("id", adminId); await db.auth.admin.deleteUser(adminId); }
});

/** Case page → bills panel → "Record payment" for `billdate` → fill + save → returns the saved funds id. */
async function recordPayment(page, billdate, payee) {
  await page.goto(`/cases/${CASE}`);
  const panel = page.getByTestId("bills-panel");
  await panel.getByRole("link", { name: `Record payment (${billdate})` }).click();
  await page.waitForURL(/\/funds\/new\?/);
  assert.equal(await page.getByLabel("Case", { exact: true }).inputValue(), String(CASE));
  await page.getByLabel("Amount").fill("12.34");
  await page.getByLabel("Payee").fill(payee);
  await page.getByRole("button", { name: "Record funds" }).click();
  await page.waitForURL((u) => /^\/funds\/\d+$/.test(u.pathname));
  const url = new URL(page.url());
  return { id: Number(url.pathname.split("/").pop()), url };
}

test("Paid bill shows its billpaiddate exactly as stored; open bills get links, the Paid bill none", { skip }, async () => {
  await admin.goto(`/cases/${CASE}`);
  const panel = admin.getByTestId("bills-panel");
  assert.equal((await panel.getByTestId("bill-paid-date").innerText()).trim(), PAID_DATE);
  const paidRow = panel.getByTestId("case-bill").filter({ has: admin.locator(`a[href="/bills/${paid}"]`) });
  assert.ok((await paidRow.innerText()).includes(PAID_DATE), "paid date inside the Paid bill's row");
  assert.equal(await panel.locator(`a[href*="bill=${paid}"]`).count(), 0, "no Record payment link for the Paid bill");
  assert.equal(await panel.getByRole("link", { name: /^Record payment/ }).count(), 2);
  assert.equal(await panel.getByRole("link", { name: "Record payment (2026-08-10)" }).getAttribute("href"), `/funds/new?case=${CASE}&bill=${newer}`);
  assert.equal((await panel.getByTestId("unpaid-bill-count").innerText()).trim(), "2");
  assert.equal((await panel.getByTestId("second-notice-date").innerText()).trim(), "2026-09-01");
});

test("admin: Record payment on the NEWER open bill → save funds → /funds/<id> with that bill preselected", { skip }, async () => {
  const { id, url } = await recordPayment(admin, "2026-08-10", "QA bill-link admin");
  assert.ok(id > 0);
  assert.equal(url.searchParams.get("bill"), String(newer));
  assert.equal(await select(admin).inputValue(), `${newer}:2nd`);
  const row = ok(await db.from("tblfundsrcvd").select("fndscaseid, fndspmt").eq("fndsid", id).single());
  assert.equal(row.fndscaseid, CASE);
  assert.equal(Number(row.fndspmt), 12.34);
  // decoys on the same funds row: foreign-case and Paid bill ids fall back to the oldest open bill, never render
  for (const decoy of [foreign, paid]) {
    await admin.goto(`/funds/${id}?bill=${decoy}`);
    assert.equal(await select(admin).inputValue(), `${oldest}:1st`, `?bill=${decoy} → oldest open`);
    assert.equal(await select(admin).locator(`option[value^="${decoy}:"]`).count(), 0, `no option for bill ${decoy}`);
    assert.equal(await select(admin).locator("option").count(), 2, "only this case's two open bills");
  }
});

test("staff: sees Record payment; after saving lands on /funds/<id> with no pay section", { skip }, async () => {
  const { id } = await recordPayment(staff, "2026-08-10", "QA bill-link staff");
  assert.ok(id > 0);
  await staff.getByRole("heading", { name: /^Funds #/ }).waitFor();
  assert.equal(await staff.getByRole("region", { name: "Bill payment" }).count(), 0);
  assert.equal(await staff.getByLabel("Bill", { exact: true }).count(), 0);
  assert.equal((await db.from("tblbills").select("billnotice").eq("billid", newer).single()).data.billnotice, "2nd", "bill untouched");
});
