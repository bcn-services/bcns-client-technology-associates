/**
 * Live check of the case-page Bills panel (billing item 8) through the real dev server (BASE_URL, default
 * http://localhost:3100): the real /cases/<id> page, the real /bills/new form + createBill action. Skips without the
 * server or SUPABASE_SERVICE_ROLE_KEY. Own rows on invented cases 991351/991352 (copies of case 90001's tblcase row);
 * everything on 991300–991399 is removed at setup and in after(). Throwaway admin created/deleted with the service role.
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
const ADMIN_EMAIL = `case-bills-admin-${randomUUID().slice(0, 8)}@example.test`;
const ADMIN_PASSWORD = `pw-${randomUUID()}`;
const up = await fetch(`${BASE}/login`).then((r) => r.ok, () => false);
const skip = up && process.env.SUPABASE_SERVICE_ROLE_KEY ? false : "dev server or Supabase unavailable";
const CASE = 991351; // three bills: Deadbeat (newest, with notice dates), 1st, legacy Paid; numunpaidbills 5
const CASE_NEW = 991352; // no bills; two unbilled activity rows for the journey-03 create
let db, browser, staff, admin, adminId;
const ids = {};
const ok = ({ data, error }) => { if (error) throw new Error(error.message); return data; };
const cleanup = async () => {
  ok(await db.from("tblactivity").delete().gte("actcaseid", 991300).lte("actcaseid", 991399));
  ok(await db.from("tblbills").delete().gte("billcaseid", 991300).lte("billcaseid", 991399));
  ok(await db.from("tblcase").delete().gte("caseid", 991300).lte("caseid", 991399));
};
const norm = (s) => s.replace(/\s+/g, " ").trim();

async function signIn(email, password) {
  const ctx = await browser.newContext({ baseURL: BASE });
  const page = await ctx.newPage();
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
  await cleanup();
  const src = ok(await db.from("tblcase").select("*").eq("caseid", 90001).single());
  ok(await db.from("tblcase").insert([{ ...src, caseid: CASE, numunpaidbills: 5 }, { ...src, caseid: CASE_NEW }]));
  const add = async (o) => ok(await db.from("tblbills").insert({ billcaseid: CASE, billhours: 2, ...o }).select("billid").single()).billid;
  ids.legacy = await add({ billdate: "2019-03-04", billtype: null, billhours: 0, billbalance: 75.5, billnotice: "Paid" });
  ids.first = await add({ billdate: "2026-08-01", billtype: "retainer", billbalance: 123.45, billnotice: "1st" });
  ids.dead = await add({ billdate: "2026-09-01", billtype: "timesheet", billbalance: 1234.5, billnotice: "Deadbeat", billsecondnoticedate: "2026-07-01", billfinalnoticedate: "2026-08-01" });
  const act = (d, h) => ({ actcaseid: CASE_NEW, actdate: "2026-09-02", actdescription: d, acthrs: h, actwho: 1, actbilled: false, actbillid: null });
  ok(await db.from("tblactivity").insert([act("QA case panel A", "1.500"), act("QA case panel B", "0.500")]));
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

test("(l) /cases/991351 renders the Bills panel: three bills incl. legacy, newest first, each with balance, status, /bills/<id> link", { skip }, async () => {
  await admin.goto(`/cases/${CASE}`);
  const panel = admin.getByTestId("bills-panel");
  await panel.waitFor({ timeout: 30_000 }); // streamed server component; count() does not auto-wait
  assert.equal(await panel.count(), 1, "bills-panel rendered on the case page");
  assert.equal(norm(await panel.getByRole("heading").innerText()), "Bills");
  const rows = panel.getByTestId("case-bill");
  assert.deepEqual((await rows.allInnerTexts()).map(norm), [
    "2026-09-01 timesheet 1234.50 Deadbeat",
    "2026-08-01 retainer 123.45 1st",
    "2019-03-04 75.50 Paid",
  ]);
  assert.deepEqual(await rows.locator("a").evaluateAll((as) => as.map((a) => a.getAttribute("href"))),
    [`/bills/${ids.dead}`, `/bills/${ids.first}`, `/bills/${ids.legacy}`]);
  assert.doesNotMatch(await panel.innerText(), /billed/i);
});

test("1st + Deadbeat + Paid with tblcase.numunpaidbills = 5 → unpaid-bill-count 2; notice dates from the Deadbeat bill", { skip }, async () => {
  assert.equal(ok(await db.from("tblcase").select("numunpaidbills").eq("caseid", CASE).single()).numunpaidbills, 5);
  await admin.goto(`/cases/${CASE}`);
  assert.equal(norm(await admin.getByTestId("unpaid-bill-count").innerText()), "2");
  assert.equal(norm(await admin.getByTestId("second-notice-date").innerText()), "2026-07-01");
  assert.equal(norm(await admin.getByTestId("final-notice-date").innerText()), "2026-08-01");
});

test("staff sees the panel with every bill and no New bill link; admin's New bill link → /bills/new?case=991351", { skip }, async () => {
  await staff.goto(`/cases/${CASE}`);
  assert.equal(await staff.getByTestId("bills-panel").getByTestId("case-bill").count(), 3);
  assert.equal(await staff.getByRole("link", { name: /new bill/i }).count(), 0);
  assert.equal(await staff.locator('a[href^="/bills/new"]').count(), 0);
  await admin.goto(`/cases/${CASE}`);
  assert.equal(await admin.getByTestId("bills-panel").getByRole("link", { name: "New bill" }).getAttribute("href"), `/bills/new?case=${CASE}`);
});

test("journey 03 substance: admin creates a 450.00 bill through /bills/new?case=991352 → case page shows 450.00 in the Bills panel", { skip }, async () => {
  await admin.goto(`/bills/new?case=${CASE_NEW}`);
  assert.match(await admin.getByText(/unbilled hours/i).innerText(), /2\.000/);
  await admin.getByLabel(/balance/i).fill("450.00");
  await admin.getByRole("button", { name: /create bill|save/i }).click();
  await admin.waitForURL(/\/bills\/\d+$/);
  const billId = new URL(admin.url()).pathname.split("/").pop();
  await admin.goto(`/cases/${CASE_NEW}`);
  const panel = admin.getByTestId("bills-panel");
  assert.equal(await panel.getByText("450.00").isVisible(), true);
  assert.equal(await admin.getByText(/450\.00/).count(), 1, "journey 03's getByText(/450\\.00/) resolves to one element");
  assert.deepEqual(await panel.getByTestId("case-bill").locator("a").evaluateAll((as) => as.map((a) => a.getAttribute("href"))), [`/bills/${billId}`]);
  assert.equal(norm(await panel.getByTestId("unpaid-bill-count").innerText()), "1");
});
