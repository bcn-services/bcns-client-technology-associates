/**
 * Live check of /bills/[id] (billing item 2) through the real dev server (BASE_URL, default http://localhost:3100)
 * and the real editBill server action. Skips when the server or SUPABASE_SERVICE_ROLE_KEY is unavailable.
 * Own rows live on invented case 990501 (copy of case 90001's tblcase row); everything on 990500–990599 is
 * removed at setup and in after(). A throwaway admin is created and deleted with the service role; the E2E staff
 * login is pinned to personid 1 in before() and restored in after().
 * The admin's real action POST (next-action header + body) is captured from a click and replayed verbatim.
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
const ADMIN_EMAIL = `bill-page-admin-${randomUUID().slice(0, 8)}@example.test`;
const ADMIN_PASSWORD = `pw-${randomUUID()}`;
const up = await fetch(`${BASE}/login`).then((r) => r.ok, () => false);
const skip = up && process.env.SUPABASE_SERVICE_ROLE_KEY ? false : "dev server or Supabase unavailable";
const CASE = 990501;
let db, browser, staff, admin, adminId, priorPersonId, captured;
const ids = {};
const ok = ({ data, error }) => { if (error) throw new Error(error.message); return data; };
const setPerson = async (v) => ok(await db.from("profiles").update({ personid: v }).eq("email", EMAIL));
const row = async (billid) => ok(await db.from("tblbills").select("*").eq("billid", billid).maybeSingle());
const cleanup = async () => {
  ok(await db.from("tblactivity").delete().gte("actcaseid", 990500).lte("actcaseid", 990599));
  ok(await db.from("tblbills").delete().gte("billcaseid", 990500).lte("billcaseid", 990599));
  ok(await db.from("tblcase").delete().gte("caseid", 990500).lte("caseid", 990599));
};
const addBill = async (o) => ok(await db.from("tblbills").insert({ billcaseid: CASE, billdate: "2026-08-14", billhours: 3.5, billbalance: 875, billnotice: "1st", ...o }).select("billid").single()).billid;
const addAct = async (actdescription, acthrs, actbillid) =>
  ok(await db.from("tblactivity").insert({ actcaseid: CASE, actdate: "2026-08-03", actdescription, acthrs, actwho: 1, actbilled: actbillid != null, actbillid }).select("actid").single()).actid;
const EDIT_ORIG = { billbalance: 875, billcomments: "orig comment" };

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
/** Replays the captured admin action POST verbatim with `page`'s cookies; returns the action's redirect target. */
async function replay(page) {
  const res = await page.request.post(captured.url, { headers: captured.headers, data: captured.body, maxRedirects: 0 });
  return res.headers()["x-action-redirect"] ?? res.headers()["location"] ?? `(status ${res.status()})`;
}

before(async () => {
  if (skip) return;
  db = createServerClient();
  await cleanup();
  const src = ok(await db.from("tblcase").select("*").eq("caseid", 90001).single());
  ok(await db.from("tblcase").insert({ ...src, caseid: CASE }));
  ids.legacy = await addBill({ billtype: null, billhours: 0, billnotice: "Paid", billbalance: 120.5, billpaiddate: "2019-02-01" });
  ids.edit = await addBill({ billtype: "timesheet", billnotice: "2nd", billsecondnoticedate: "2026-09-01", ...EDIT_ORIG });
  ids.other = await addBill({ billtype: "depo" });
  ids.a1 = await addAct("QA live site inspection", "2.25", ids.edit);
  ids.a2 = await addAct("QA live photo review", "1.5", ids.edit);
  ids.a3 = await addAct("QA live other-bill row", "9", ids.other);
  ids.a4 = await addAct("QA live unattached row", "4", null);
  priorPersonId = ok(await db.from("profiles").select("personid").eq("email", EMAIL).single()).personid;
  await setPerson(1);
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
  await setPerson(priorPersonId ?? null);
  if (adminId) { await db.from("profiles").delete().eq("id", adminId); await db.auth.admin.deleteUser(adminId); }
});

const field = (page, name) => page.locator(`dd[data-field="${name}"]`).innerText();

test("GET an unknown bill id → 404", { skip }, async () => {
  const absent = 987654321;
  assert.equal(await row(absent), null);
  const res = await admin.goto(`/bills/${absent}`);
  assert.equal(res.status(), 404);
});

test("legacy bill (type null, hours 0, Paid) renders balance 120.50, status Paid, em-dash type", { skip }, async () => {
  const res = await staff.goto(`/bills/${ids.legacy}`);
  assert.equal(res.status(), 200);
  assert.equal(await field(staff, "Balance"), "120.50");
  assert.equal(await field(staff, "Status"), "Paid");
  assert.equal(await field(staff, "Type"), "—");
  assert.equal(await field(staff, "Hours"), "0.00");
  assert.equal(await staff.locator(`dd[data-field="Case"] a[href="/cases/${CASE}"]`).count(), 1);
});

test("bill with two attached activity rows lists exactly those two with hours; other-bill and unattached rows on the same case absent", { skip }, async () => {
  await staff.goto(`/bills/${ids.edit}`);
  const rows = await staff.locator('tr[data-testid="bill-activity"]').allInnerTexts();
  assert.equal(rows.length, 2, JSON.stringify(rows));
  assert.ok(rows.some((r) => r.includes("QA live site inspection") && r.includes("2.250")), JSON.stringify(rows));
  assert.ok(rows.some((r) => r.includes("QA live photo review") && r.includes("1.500")), JSON.stringify(rows));
  const body = await staff.locator("main").innerText();
  assert.ok(!body.includes("QA live other-bill row") && !body.includes("QA live unattached row"));
});

test("admin edits balance 875.00 → 900.00 + comments via the form; reload shows both; notice/hours/case/dates unchanged", { skip }, async () => {
  const before = await row(ids.edit);
  await admin.goto(`/bills/${ids.edit}`);
  await admin.getByLabel("Balance").fill("900.00");
  await admin.getByLabel("Comments").fill("QA live: client called");
  const reqP = admin.waitForRequest((r) => r.method() === "POST" && !!r.headers()["next-action"]);
  await admin.getByRole("button", { name: "Update bill" }).click();
  const req = await reqP;
  captured = { url: req.url(), headers: { ...req.headers() }, body: req.postDataBuffer() };
  await admin.waitForURL((u) => u.searchParams.get("saved") === "1");
  await admin.reload();
  assert.equal(await field(admin, "Balance"), "900.00");
  assert.equal(await field(admin, "Comments"), "QA live: client called");
  assert.equal(await admin.getByLabel("Balance").inputValue(), "900.00");
  const after = await row(ids.edit);
  assert.equal(Number(after.billbalance), 900);
  assert.equal(after.billcomments, "QA live: client called");
  for (const c of ["billnotice", "billhours", "billcaseid", "billsecondnoticedate", "billfinalnoticedate", "billpaiddate", "billdate", "billtype", "billreports", "billpriority", "supersedesbillid"]) {
    assert.deepEqual(after[c], before[c], c);
  }
  const acts = ok(await db.from("tblactivity").select("actid, actbillid, acthrs, actdescription").in("actid", [ids.a1, ids.a2]).order("actid"));
  assert.deepEqual(acts.map((a) => [a.actbillid, Number(a.acthrs)]), [[ids.edit, 2.25], [ids.edit, 1.5]]);
});

test("replayed edit POST: admin control writes; staff replay is refused and the row is unchanged column-by-column", { skip }, async () => {
  assert.ok(captured, "admin action POST was captured");
  ok(await db.from("tblbills").update(EDIT_ORIG).eq("billid", ids.edit));
  const adminLoc = await replay(admin);
  assert.match(adminLoc, new RegExp(`/bills/${ids.edit}\\?saved=1`));
  assert.equal(Number((await row(ids.edit)).billbalance), 900, "admin control replay wrote");
  ok(await db.from("tblbills").update(EDIT_ORIG).eq("billid", ids.edit));
  const snap = await row(ids.edit);
  const staffLoc = await replay(staff);
  assert.match(staffLoc, new RegExp(`/bills/${ids.edit}\\?error=forbidden`));
  assert.deepEqual(await row(ids.edit), snap);
});

test("staff GET shows every field but no edit form or Update bill button", { skip }, async () => {
  await staff.goto(`/bills/${ids.edit}`);
  assert.equal(await field(staff, "Status"), "2nd");
  assert.equal(await staff.locator('form[data-testid="bill-edit"]').count(), 0);
  assert.equal(await staff.getByRole("button", { name: "Update bill" }).count(), 0);
  assert.equal(await staff.getByLabel("Balance").count(), 0);
});
