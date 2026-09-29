/**
 * Live check of Finalize (billing-output item 3) through the real dev server (BASE_URL, default http://localhost:3150)
 * and the real finalizeBillAction, clicked with Playwright. Skips without the server or SUPABASE_SERVICE_ROLE_KEY.
 * Own rows on invented case 992301 (copy of case 90001's tblcase row, billing alert on); everything on 992300–992399 is
 * removed at setup and in after() — lines before bills. Throwaway admin created/deleted with the service role.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { chromium } from "@playwright/test";
import { loadEnvLocal, seedE2eUser } from "../app-shell/seed-e2e.ts";
import { createServerClient } from "../../lib/db/client.ts";

loadEnvLocal();
const BASE = process.env.BASE_URL ?? "http://localhost:3150";
const EMAIL = process.env.E2E_EMAIL ?? "staff@example.test";
const ADMIN_EMAIL = `bill-final-admin-${randomUUID().slice(0, 8)}@example.test`;
const ADMIN_PASSWORD = `pw-${randomUUID()}`;
const up = await fetch(`${BASE}/login`).then((r) => r.ok, () => false);
const skip = up && process.env.SUPABASE_SERVICE_ROLE_KEY ? false : "dev server or Supabase unavailable";
const CASE = 992301;
let db, browser, staff, admin, adminId;
const ok = ({ data, error }) => { if (error) throw new Error(error.message); return data; };
const cleanup = async () => {
  const bills = ok(await db.from("tblbills").select("billid").gte("billcaseid", 992300).lte("billcaseid", 992399)).map((b) => b.billid);
  if (bills.length) ok(await db.from("tblbilllines").delete().in("billid", bills));
  ok(await db.from("tblactivity").delete().gte("actcaseid", 992300).lte("actcaseid", 992399));
  ok(await db.from("tblfundsrcvd").delete().gte("fndscaseid", 992300).lte("fndscaseid", 992399));
  ok(await db.from("tblbills").update({ supersedesbillid: null }).gte("billcaseid", 992300).lte("billcaseid", 992399));
  ok(await db.from("tblbills").delete().gte("billcaseid", 992300).lte("billcaseid", 992399));
  ok(await db.from("tblcase").delete().gte("caseid", 992300).lte("caseid", 992399));
};
const bill = async (id) => ok(await db.from("tblbills").select("*").eq("billid", id).single());
const lines = async (id) => ok(await db.from("tblbilllines").select("lineno, kind, description, personid, hours, rate, amount").eq("billid", id).order("lineno"));
const addBill = async (o = {}) => ok(await db.from("tblbills").insert({ billcaseid: CASE, billdate: "2026-09-01", billhours: 0, billbalance: 0, billtype: "timesheet", billnotice: "1st", ...o }).select("billid").single()).billid;
const addAct = async (billid, h, who, date) => ok(await db.from("tblactivity").insert({ actcaseid: CASE, actdate: date, actdescription: `finalize live ${h}`, acthrs: h, actwho: who, actbilled: true, actbillid: billid }).select("actid").single()).actid;
const timesheet = async () => { const B = await addBill(); await addAct(B, "2.000", 1, "2026-08-10"); await addAct(B, "1.500", 2, "2026-08-11"); return B; };

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
async function clickCapture(page, button) {
  const reqP = page.waitForRequest((r) => r.method() === "POST" && !!r.headers()["next-action"]);
  await button.click();
  const req = await reqP;
  return { url: req.url(), headers: { ...req.headers() }, body: req.postDataBuffer() };
}
async function replay(page, cap) {
  const res = await page.request.post(cap.url, { headers: cap.headers, data: cap.body, maxRedirects: 0 });
  return res.headers()["x-action-redirect"] ?? res.headers()["location"] ?? `(status ${res.status()})`;
}
const saveBtn = (page) => page.getByRole("button", { name: /save|finalize/i });
const finalizeLink = (page) => page.getByRole("link", { name: /finalize/i });
const perPerson = (ls) => ls.filter((l) => l.personid !== null).map((l) => [l.personid, Number(l.rate)]);

before(async () => {
  if (skip) return;
  db = createServerClient();
  await cleanup();
  const src = ok(await db.from("tblcase").select("*").eq("caseid", 90001).single());
  ok(await db.from("tblcase").insert({ ...src, caseid: CASE, casestartdate: "2026-01-10", billingalert: true }));
  adminId = (await seedE2eUser(db, ADMIN_EMAIL, ADMIN_PASSWORD)).id;
  ok(await db.from("profiles").update({ role: "admin" }).eq("id", adminId));
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

test("admin: Finalize link → rate box per person, live total, KJS 399.00 saved while JON keeps default; bill locked; replay is stale", { skip }, async () => {
  const B = await timesheet();
  await admin.goto(`/bills/${B}`);
  await finalizeLink(admin).click();
  await admin.waitForURL((u) => u.pathname === `/bills/${B}/finalize`);
  assert.equal(await admin.getByTestId("bill-recipient-alert").count(), 1, "case BillingAlert banner");
  assert.equal(await admin.getByLabel("Rate for KJS").inputValue(), "435.00");
  assert.equal(await admin.getByLabel("Rate for JON").inputValue(), "326.25");
  assert.match(await admin.getByTestId("finalize-preview-total").innerText(), /Balance \$1,359\.00/);
  await admin.getByLabel("Rate for KJS").fill("399.00");
  assert.match(await admin.getByTestId("finalize-preview-total").innerText(), /Total hours 3\.50 · Balance \$1,287\.00/, "live total");
  assert.equal(await saveBtn(admin).count(), 1);
  const cap = await clickCapture(admin, saveBtn(admin));
  await admin.waitForURL((u) => u.pathname === `/bills/${B}` && u.search === "?saved=1");

  assert.deepEqual(perPerson(await lines(B)), [[1, 399], [2, 326.25]]);
  const b = await bill(B);
  assert.ok(b.billfinalizedat);
  assert.deepEqual([Number(b.billhours), Number(b.billbalance)], [3.5, 1287]);
  assert.equal(await admin.getByTestId("bill-finalized").count(), 1);
  assert.equal(await admin.getByTestId("bill-edit").count(), 0, "edit form hidden on a finalized bill");
  assert.equal(await finalizeLink(admin).count(), 0);

  const snap = JSON.stringify([await bill(B), await lines(B)]);
  assert.match(await replay(admin, cap), new RegExp(`/bills/${B}/finalize\\?error=stale`), "double submit");
  assert.equal(JSON.stringify([await bill(B), await lines(B)]), snap, "0 rows changed");

  // Defaults move (case now > 2 years old → late rates): the saved bill still shows its stored lines.
  ok(await db.from("tblcase").update({ casestartdate: "2020-01-01" }).eq("caseid", CASE));
  await admin.goto(`/bills/${B}/finalize`);
  assert.match(await admin.getByTestId("finalize-stored").innerText(), /2 hrs x \$399\/hr[\s\S]*1\.5 hrs x \$326\.25\/hr/);
  assert.match(await admin.getByTestId("finalize-stored-total").innerText(), /Balance \$1,287\.00/);
  assert.equal(await saveBtn(admin).count(), 0);
  ok(await db.from("tblcase").update({ casestartdate: "2026-01-10" }).eq("caseid", CASE));

  // Staff replay of the same POST on a reset (unfinalized) bill is refused by the admin check alone.
  ok(await db.from("tblbilllines").delete().eq("billid", B));
  ok(await db.from("tblbills").update({ billfinalizedat: null, billhours: 0, billbalance: 0 }).eq("billid", B));
  const open = await bill(B);
  assert.match(await replay(staff, cap), new RegExp(`/bills/${B}/finalize\\?error=forbidden`), "staff replay");
  assert.deepEqual(await bill(B), open);
  assert.equal((await lines(B)).length, 0);
  assert.match(await replay(admin, cap), new RegExp(`/bills/${B}\\?saved=1`), "admin control replay");
  assert.deepEqual(perPerson(await lines(B)), [[1, 399], [2, 326.25]]);
});

test("staff: no Finalize control on the bill page or the finalize page", { skip }, async () => {
  const B = await timesheet();
  await staff.goto(`/bills/${B}`);
  assert.equal(await finalizeLink(staff).count(), 0);
  await staff.goto(`/bills/${B}/finalize`);
  assert.equal(await saveBtn(staff).count(), 0);
  assert.equal(await staff.getByLabel(/^rate for/i).count(), 0);
});

test("legacy bill (billtype null): no Finalize link, finalize page offers nothing", { skip }, async () => {
  const L = await addBill({ billtype: null, billnotice: "Paid", billbalance: 75.5 });
  await admin.goto(`/bills/${L}`);
  assert.equal(await finalizeLink(admin).count(), 0);
  await admin.goto(`/bills/${L}/finalize`);
  assert.equal(await saveBtn(admin).count(), 0);
  assert.match(await admin.locator("main").innerText(), /legacy bill/i);
});

test("line insert fails (rate too large for the column) → bill un-finalized, no lines, form error shown", { skip }, async () => {
  const B = await timesheet();
  await admin.goto(`/bills/${B}/finalize`);
  await admin.getByLabel("Rate for KJS").fill("999999999.00");
  await saveBtn(admin).click();
  await admin.waitForURL((u) => u.pathname === `/bills/${B}/finalize` && u.search === "?error=failed");
  const b = await bill(B);
  assert.deepEqual([b.billfinalizedat, Number(b.billhours), Number(b.billbalance)], [null, 0, 0]);
  assert.equal((await lines(B)).length, 0);
  assert.match(await admin.getByRole("alert").first().innerText(), /could not be finalized/);
  // Still finalizable afterwards.
  await admin.getByLabel("Rate for KJS").fill("399.00");
  await saveBtn(admin).click();
  await admin.waitForURL((u) => u.pathname === `/bills/${B}`);
  assert.deepEqual(perPerson(await lines(B)), [[1, 399], [2, 326.25]]);
});
