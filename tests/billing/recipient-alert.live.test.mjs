/**
 * Live check of the recipient alert (billing item 7) through the real dev server (BASE_URL, default http://localhost:3100):
 * /bills/new?case=<id> and /bills/<billid> signed in as a throwaway admin (/bills/new is admin-only).
 * Skips without the server or SUPABASE_SERVICE_ROLE_KEY. Own rows on invented cases 991001 (alert true + cc) and
 * 991002 (alert false + cc), copies of case 90001's tblcase row; everything on 991000–991099 is removed at setup and in after().
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { chromium } from "@playwright/test";
import { loadEnvLocal, seedE2eUser } from "../app-shell/seed-e2e.ts";
import { createServerClient } from "../../lib/db/client.ts";

loadEnvLocal();
const BASE = process.env.BASE_URL ?? "http://localhost:3100";
const ADMIN_EMAIL = `bill-alert-admin-${randomUUID().slice(0, 8)}@example.test`;
const ADMIN_PASSWORD = `pw-${randomUUID()}`;
const up = await fetch(`${BASE}/login`).then((r) => r.ok, () => false);
const skip = up && process.env.SUPABASE_SERVICE_ROLE_KEY ? false : "dev server or Supabase unavailable";
const ALERT_CASE = 991001;
const PLAIN_CASE = 991002;
const CC = "a@x.test, b@x.test";
const BANNER = "Bill recipient alert — this case bills a different party";
let db, browser, admin, adminId;
const ids = {};
const ok = ({ data, error }) => { if (error) throw new Error(error.message); return data; };
const cleanup = async () => {
  ok(await db.from("tblbills").delete().gte("billcaseid", 991000).lte("billcaseid", 991099));
  ok(await db.from("tblcase").delete().gte("caseid", 991000).lte("caseid", 991099));
};
const addBill = async (billcaseid) =>
  ok(await db.from("tblbills").insert({ billcaseid, billdate: "2026-09-01", billhours: 0, billbalance: 300, billnotice: "1st", billtype: "retainer" }).select("billid").single()).billid;

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
  ok(await db.from("tblcase").insert({ ...src, caseid: ALERT_CASE, billingalert: true, billingcc: CC }));
  ok(await db.from("tblcase").insert({ ...src, caseid: PLAIN_CASE, billingalert: false, billingcc: CC }));
  ids.alertBill = await addBill(ALERT_CASE);
  ids.plainBill = await addBill(PLAIN_CASE);
  adminId = (await seedE2eUser(db, ADMIN_EMAIL, ADMIN_PASSWORD)).id;
  ok(await db.from("profiles").update({ role: "admin", personid: 2 }).eq("id", adminId));
  browser = await chromium.launch();
  admin = await signIn(ADMIN_EMAIL, ADMIN_PASSWORD);
});
after(async () => {
  await browser?.close();
  if (!db) return;
  await cleanup();
  if (adminId) { await db.from("profiles").delete().eq("id", adminId); await db.auth.admin.deleteUser(adminId); }
});

/** Status, banner count and every CC line on the real page (matched by visible text, not first-match). */
async function look(path) {
  const res = await admin.goto(path);
  const main = await admin.locator("main").innerText();
  return {
    status: res.status(),
    banners: await admin.getByText(BANNER, { exact: true }).count(),
    cc: main.split("\n").map((l) => l.trim()).filter((l) => l.startsWith("CC:")),
  };
}

test("alert case: /bills/new?case=991001 shows the banner and 'CC: a@x.test, b@x.test'", { skip }, async () => {
  assert.deepEqual(await look(`/bills/new?case=${ALERT_CASE}`), { status: 200, banners: 1, cc: ["CC: a@x.test, b@x.test"] });
});

test("alert case: its bill page /bills/<id> shows the banner and 'CC: a@x.test, b@x.test'", { skip }, async () => {
  assert.deepEqual(await look(`/bills/${ids.alertBill}`), { status: 200, banners: 1, cc: ["CC: a@x.test, b@x.test"] });
});

test("alert-false case with cc: /bills/new?case=991002 shows no banner but the CC line", { skip }, async () => {
  assert.deepEqual(await look(`/bills/new?case=${PLAIN_CASE}`), { status: 200, banners: 0, cc: ["CC: a@x.test, b@x.test"] });
});

test("alert-false case with cc: its bill page shows no banner but the CC line", { skip }, async () => {
  assert.deepEqual(await look(`/bills/${ids.plainBill}`), { status: 200, banners: 0, cc: ["CC: a@x.test, b@x.test"] });
});
