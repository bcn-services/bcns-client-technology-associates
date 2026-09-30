/**
 * Live check of /bills/new (billing item 3) through the real dev server (BASE_URL, default http://localhost:3100)
 * and the real createBill server action. Skips without the server or SUPABASE_SERVICE_ROLE_KEY.
 * Own rows on invented case 990601 (copy of case 90001's tblcase row, so a real attorney); everything on
 * 990600–990699 is removed at setup and in after(). Throwaway admin created/deleted with the service role.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { chromium } from "@playwright/test";
import { loadEnvLocal, seedE2eUser } from "../app-shell/seed-e2e.ts";
import { createServerClient } from "../../lib/db/client.ts";
import { firmToday } from "../../lib/cases/presets.ts";

loadEnvLocal();
const BASE = process.env.BASE_URL ?? "http://localhost:3100";
const EMAIL = process.env.E2E_EMAIL ?? "staff@example.test";
const ADMIN_EMAIL = `bill-new-admin-${randomUUID().slice(0, 8)}@example.test`;
const ADMIN_PASSWORD = `pw-${randomUUID()}`;
const up = await fetch(`${BASE}/login`).then((r) => r.ok, () => false);
const skip = up && process.env.SUPABASE_SERVICE_ROLE_KEY ? false : "dev server or Supabase unavailable";
const CASE = 990601;
let db, browser, staff, admin, adminId, priorPersonId, captured, attyLast;
const ids = {};
const ok = ({ data, error }) => { if (error) throw new Error(error.message); return data; };
const cleanup = async () => {
  ok(await db.from("tblactivity").delete().gte("actcaseid", 990600).lte("actcaseid", 990699));
  ok(await db.from("tblbills").delete().gte("billcaseid", 990600).lte("billcaseid", 990699));
  ok(await db.from("tblcase").delete().gte("caseid", 990600).lte("caseid", 990699));
};
const bills = async () => ok(await db.from("tblbills").select("*").eq("billcaseid", CASE).order("billid"));
const acts = async () => ok(await db.from("tblactivity").select("actid, actbilled, actbillid").in("actid", [ids.a1, ids.a2]).order("actid"))
  .map((r) => [r.actbilled, r.actbillid]);
const unbillAll = async () => {
  ok(await db.from("tblactivity").update({ actbilled: false, actbillid: null }).in("actid", [ids.a1, ids.a2]));
  ok(await db.from("tblbills").delete().eq("billcaseid", CASE));
};

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
async function replay(page) {
  const res = await page.request.post(captured.url, { headers: captured.headers, data: captured.body, maxRedirects: 0 });
  return res.headers()["x-action-redirect"] ?? res.headers()["location"] ?? `(status ${res.status()})`;
}

before(async () => {
  if (skip) return;
  db = createServerClient();
  await cleanup();
  const src = ok(await db.from("tblcase").select("*").eq("caseid", 90001).single());
  attyLast = ok(await db.from("tblattorney").select("attylastname").eq("attyid", src.caseatty).single()).attylastname.trim();
  ok(await db.from("tblcase").insert({ ...src, caseid: CASE }));
  const add = async (d, h) => ok(await db.from("tblactivity").insert({ actcaseid: CASE, actdate: "2026-09-02", actdescription: d, acthrs: h, actwho: 1, actbilled: false, actbillid: null }).select("actid").single()).actid;
  ids.a1 = await add("QA create live A", "1.500");
  ids.a2 = await add("QA create live B", "0.500");
  priorPersonId = ok(await db.from("profiles").select("personid").eq("email", EMAIL).single()).personid;
  ok(await db.from("profiles").update({ personid: 1 }).eq("email", EMAIL));
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
  ok(await db.from("profiles").update({ personid: priorPersonId ?? null }).eq("email", EMAIL));
  if (adminId) { await db.from("profiles").delete().eq("id", adminId); await db.auth.admin.deleteUser(adminId); }
});

const boxes = () => admin.locator('[data-testid="bill-row"] input[type="checkbox"]');

test("journey-03 selectors each match exactly once; timesheet default checks both rows; switching to retainer unchecks them", { skip }, async () => {
  await admin.goto(`/bills/new?case=${CASE}`);
  assert.equal(await admin.getByText(/unbilled hours/i).count(), 1);
  assert.equal(await admin.getByLabel(/balance/i).count(), 1);
  assert.equal(await admin.getByRole("button", { name: /create bill|save/i }).count(), 1);
  assert.match(await admin.getByText(/unbilled hours/i).innerText(), /2\.000/);
  assert.deepEqual(await boxes().evaluateAll((els) => els.map((e) => e.checked)), [true, true]);
  await admin.getByLabel("Bill type").selectOption("retainer");
  assert.deepEqual(await boxes().evaluateAll((els) => els.map((e) => e.checked)), [false, false]);
});

test("done-when 2 live: retainer saved with nothing checked → billhours 0, both rows still unbilled", { skip }, async () => {
  await admin.goto(`/bills/new?case=${CASE}`);
  await admin.getByLabel("Bill type").selectOption("retainer");
  await admin.getByLabel("Bill date").fill("2026-01-02");
  await admin.getByLabel(/balance/i).fill("100.00");
  await admin.getByRole("button", { name: "Create bill" }).click();
  await admin.waitForURL(/\/bills\/\d+$/);
  const b = await bills();
  assert.equal(b.length, 1);
  assert.equal(Number(b[0].billhours), 0);
  assert.deepEqual(await acts(), [[false, null], [false, null]]);
  await unbillAll();
});

test("stale live: row B turned legacy-billed after the form loads → error=stale, no bill, row A unbilled", { skip }, async () => {
  await admin.goto(`/bills/new?case=${CASE}`);
  await admin.getByLabel(/balance/i).fill("450.00");
  ok(await db.from("tblactivity").update({ actbilled: true }).eq("actid", ids.a2)); // own row, not a hosted fixture
  await admin.getByRole("button", { name: "Create bill" }).click();
  await admin.waitForURL((u) => u.searchParams.get("error") === "stale");
  assert.deepEqual(await bills(), []);
  assert.deepEqual(await acts(), [[false, null], [true, null]]);
  ok(await db.from("tblactivity").update({ actbilled: false }).eq("actid", ids.a2));
});

test("done-when 1 live: timesheet defaults + balance 450.00 → /bills/<id>; hours 2.000, 1st, filename -0, rows claimed, unbilled 0.000", { skip }, async () => {
  await admin.goto(`/bills/new?case=${CASE}`);
  await admin.getByLabel(/balance/i).fill("450.00");
  const reqP = admin.waitForRequest((r) => r.method() === "POST" && !!r.headers()["next-action"]);
  await admin.getByRole("button", { name: /create bill|save/i }).click();
  const req = await reqP;
  captured = { url: req.url(), headers: { ...req.headers() }, body: req.postDataBuffer() };
  await admin.waitForURL(/\/bills\/\d+$/);
  const b = await bills();
  assert.equal(b.length, 1);
  assert.equal(new URL(admin.url()).pathname, `/bills/${b[0].billid}`);
  assert.equal(Number(b[0].billhours), 2);
  assert.equal(b[0].billnotice, "1st");
  assert.equal(Number(b[0].billbalance), 450);
  assert.equal(b[0].billfilename, `Bill${CASE} ${attyLast} ${firmToday(new Date()).replaceAll("-", " ")}-0`);
  assert.deepEqual(await acts(), [[true, b[0].billid], [true, b[0].billid]]);
  await admin.goto(`/bills/new?case=${CASE}`);
  assert.match(await admin.getByText(/unbilled hours/i).innerText(), /0\.000/);
});

test("replayed create POST: admin control inserts a bill; staff replay → error=forbidden and no tblbills row", { skip }, async () => {
  assert.ok(captured, "admin action POST was captured");
  await unbillAll();
  assert.match(await replay(admin), /\/bills\/\d+/);
  assert.equal((await bills()).length, 1, "admin control replay wrote");
  await unbillAll();
  assert.match(await replay(staff), /error=forbidden/);
  assert.deepEqual(await bills(), []);
  assert.deepEqual(await acts(), [[false, null], [false, null]]);
});
