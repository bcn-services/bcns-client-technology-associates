/**
 * Live check of the item 3 review fixes through the dev server (BASE_URL, default http://localhost:3150): a revised bill
 * can't be finalized from a stale tab, a finalized bill with missing lines is flagged and Revise rebuilds it, a 0-line
 * $0 finalize isn't flagged, and an edit submitted after the bill was finalized is refused as locked.
 * Own rows on invented cases 992501–992509 (copies of fixture case 90001's tblcase row); everything on 992500–992549
 * removed at setup and in after(). Throwaway admin created/deleted with the service role. Skips without the server.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { chromium } from "@playwright/test";
import { loadEnvLocal, seedE2eUser } from "../app-shell/seed-e2e.ts";
import { createServerClient } from "../../lib/db/client.ts";

loadEnvLocal();
const BASE = process.env.BASE_URL ?? "http://localhost:3150";
const ADMIN_EMAIL = `bill-fix3-admin-${randomUUID().slice(0, 8)}@example.test`;
const ADMIN_PASSWORD = `pw-${randomUUID()}`;
const up = await fetch(`${BASE}/login`).then((r) => r.ok, () => false);
const skip = up && process.env.SUPABASE_SERVICE_ROLE_KEY ? false : "dev server or Supabase unavailable";
const LO = 992500, HI = 992549;
let db, browser, admin, adminCtx, adminId, nextCase = 992501;
const ok = ({ data, error }) => { if (error) throw new Error(error.message); return data; };
const cleanup = async () => {
  const bills = ok(await db.from("tblbills").select("billid").gte("billcaseid", LO).lte("billcaseid", HI)).map((b) => b.billid);
  if (bills.length) ok(await db.from("tblbilllines").delete().in("billid", bills));
  ok(await db.from("tblactivity").delete().gte("actcaseid", LO).lte("actcaseid", HI));
  ok(await db.from("tblbills").update({ supersedesbillid: null }).gte("billcaseid", LO).lte("billcaseid", HI));
  ok(await db.from("tblbills").delete().gte("billcaseid", LO).lte("billcaseid", HI));
  ok(await db.from("tblcase").delete().gte("caseid", LO).lte("caseid", HI));
};
const newCase = async () => {
  const src = ok(await db.from("tblcase").select("*").eq("caseid", 90001).single());
  const id = nextCase++;
  ok(await db.from("tblcase").insert({ ...src, caseid: id, casestartdate: "2026-01-10", billingalert: false, billingcc: null }));
  return id;
};
const addBill = async (c, o = {}) => ok(await db.from("tblbills").insert({ billcaseid: c, billdate: "2026-09-01", billhours: 0, billbalance: 0, billtype: "timesheet", billnotice: "1st", ...o }).select("billid").single()).billid;
const addAct = async (c, b, h, who, date) => ok(await db.from("tblactivity").insert({ actcaseid: c, actdate: date, actdescription: `fix3 ${h}`, acthrs: h, actwho: who, actbilled: true, actbillid: b }).select("actid").single()).actid;
const timesheet = async () => { const C = await newCase(); const B = await addBill(C); await addAct(C, B, "2.000", 1, "2026-08-10"); await addAct(C, B, "1.500", 2, "2026-08-11"); return B; };
const bill = async (id) => ok(await db.from("tblbills").select("*").eq("billid", id).single());
const lines = async (id) => ok(await db.from("tblbilllines").select("lineno, personid, rate, amount").eq("billid", id).order("lineno"));
const saveBtn = (page) => page.getByRole("button", { name: /finalize bill/i });

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
  return [ctx, page];
}

before(async () => {
  if (skip) return;
  db = createServerClient();
  await cleanup();
  adminId = (await seedE2eUser(db, ADMIN_EMAIL, ADMIN_PASSWORD)).id;
  ok(await db.from("profiles").update({ role: "admin" }).eq("id", adminId));
  browser = await chromium.launch();
  [adminCtx, admin] = await signIn(ADMIN_EMAIL, ADMIN_PASSWORD);
});
after(async () => {
  await browser?.close();
  if (!db) return;
  await cleanup();
  if (adminId) { await db.from("profiles").delete().eq("id", adminId); await db.auth.admin.deleteUser(adminId); }
});

test("revised in another tab → the stale Finalize tab's save is refused (?error=revised), B untouched; B offers no Finalize", { skip }, async () => {
  const B = await timesheet();
  await admin.goto(`/bills/${B}/finalize`);
  assert.equal(await saveBtn(admin).count(), 1);
  const tab2 = await adminCtx.newPage();
  await tab2.goto(`/bills/${B}`);
  await tab2.getByRole("button", { name: /^revise$/i }).click();
  await tab2.waitForURL((u) => u.pathname !== `/bills/${B}` && /^\/bills\/\d+$/.test(u.pathname));
  const B2 = Number(new URL(tab2.url()).pathname.split("/").pop());
  assert.equal((await bill(B)).billnotice, "Cancelled");
  const before = await bill(B);

  await admin.getByLabel("Rate for KJS").fill("399.00");
  await saveBtn(admin).click();
  await admin.waitForURL((u) => u.pathname === `/bills/${B}/finalize` && u.search === "?error=revised");
  assert.match(await admin.getByRole("alert").first().innerText(), /revised or closed/);
  assert.deepEqual(await bill(B), before);
  assert.equal((await lines(B)).length, 0);
  assert.equal(await saveBtn(admin).count(), 0, "no form on a revised bill");
  assert.equal(await admin.getByTestId("finalize-closed").count(), 1);
  await admin.goto(`/bills/${B}`);
  assert.equal(await admin.getByTestId("bill-finalize").count(), 0);
  await admin.goto(`/bills/${B2}`);
  assert.equal(await admin.getByTestId("bill-finalize").count(), 1, "the revision is the one to finalize");
  await tab2.close();
});

test("finalized with missing lines → 'Lines missing' on the bill and Finalize pages; Revise rebuilds it; B′ saves clean", { skip }, async () => {
  const B = await timesheet();
  ok(await db.from("tblbills").update({ billfinalizedat: "2026-09-28T15:00:00Z", billhours: 3.5, billbalance: 1287 }).eq("billid", B));
  await admin.goto(`/bills/${B}`);
  assert.equal(await admin.getByTestId("bill-broken").innerText(), "Lines missing: use Revise to rebuild this bill");
  await admin.goto(`/bills/${B}/finalize`);
  assert.equal(await admin.getByTestId("finalize-broken").count(), 1);

  await admin.goto(`/bills/${B}`);
  await admin.getByRole("button", { name: /^revise$/i }).click();
  await admin.waitForURL((u) => u.pathname !== `/bills/${B}` && /^\/bills\/\d+$/.test(u.pathname));
  const B2 = Number(new URL(admin.url()).pathname.split("/").pop());
  await admin.getByTestId("bill-finalize").click();
  await admin.waitForURL((u) => u.pathname === `/bills/${B2}/finalize`);
  assert.equal(await admin.getByLabel("Rate for KJS").inputValue(), "435.00", "B′ starts from defaults (B had no stored lines)");
  await saveBtn(admin).click();
  await admin.waitForURL((u) => u.pathname === `/bills/${B2}` && u.search === "?saved=1");
  assert.equal(await admin.getByTestId("bill-broken").count(), 0);
  const b2 = await bill(B2);
  assert.deepEqual([!!b2.billfinalizedat, Number(b2.billbalance)], [true, 1359]);
  assert.equal((await lines(B2)).length, 4);
  await admin.goto(`/bills/${B}`);
  assert.equal(await admin.getByTestId("bill-broken").count(), 0, "revised → no longer told to Revise");
  assert.equal((await bill(B)).billnotice, "Cancelled");
});

test("a legitimate 0-line $0 finalize (blank bill) is not flagged", { skip }, async () => {
  const C = await newCase();
  const B = await addBill(C, { billtype: "blank" });
  await admin.goto(`/bills/${B}/finalize`);
  await saveBtn(admin).click();
  await admin.waitForURL((u) => u.pathname === `/bills/${B}` && u.search === "?saved=1");
  const b = await bill(B);
  assert.deepEqual([!!b.billfinalizedat, Number(b.billbalance), (await lines(B)).length], [true, 0, 0]);
  assert.equal(await admin.getByTestId("bill-finalized").count(), 1);
  assert.equal(await admin.getByTestId("bill-broken").count(), 0);
});

test("edit lock: an Edit form opened before the bill was finalized is refused as locked; billbalance untouched", { skip }, async () => {
  const B = await timesheet();
  await admin.goto(`/bills/${B}`);
  assert.equal(await admin.getByTestId("bill-edit").count(), 1);
  ok(await db.from("tblbills").update({ billfinalizedat: "2026-09-28T15:00:00Z", billhours: 3.5, billbalance: 1359 }).eq("billid", B));
  await admin.getByLabel("Balance").fill("1.00");
  await admin.getByRole("button", { name: "Update bill" }).click();
  await admin.waitForURL((u) => u.pathname === `/bills/${B}` && u.search === "?error=locked");
  assert.equal(Number((await bill(B)).billbalance), 1359);
});
