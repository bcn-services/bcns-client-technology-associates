/**
 * Live check of Revise on /bills/[id] (billing item 5) through the real dev server (BASE_URL, default
 * http://localhost:3100) and the real reviseBillAction server action, clicked with Playwright (Chrome login expired —
 * Playwright is the accepted substitute). Skips without the server or SUPABASE_SERVICE_ROLE_KEY. Own rows on invented
 * case 990901 (copy of case 90001's tblcase row); everything on 990900–990999 is removed at setup and in after().
 * Throwaway admin created/deleted with the service role. Each test builds its own bill + rows — no test depends on another.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { chromium } from "@playwright/test";
import { loadEnvLocal, seedE2eUser } from "../app-shell/seed-e2e.ts";
import { createServerClient } from "../../lib/db/client.ts";
import { unbilledHours, listCaseTime } from "../../lib/time/case.ts";

loadEnvLocal();
const BASE = process.env.BASE_URL ?? "http://localhost:3100";
const EMAIL = process.env.E2E_EMAIL ?? "staff@example.test";
const ADMIN_EMAIL = `bill-revise-admin-${randomUUID().slice(0, 8)}@example.test`;
const ADMIN_PASSWORD = `pw-${randomUUID()}`;
const up = await fetch(`${BASE}/login`).then((r) => r.ok, () => false);
const skip = up && process.env.SUPABASE_SERVICE_ROLE_KEY ? false : "dev server or Supabase unavailable";
const CASE = 990901;
let db, browser, staff, admin, adminId, priorPersonId;
const ok = ({ data, error }) => { if (error) throw new Error(error.message); return data; };
const cleanup = async () => {
  ok(await db.from("tblactivity").delete().gte("actcaseid", 990900).lte("actcaseid", 990999));
  ok(await db.from("tblbills").update({ supersedesbillid: null }).gte("billcaseid", 990900).lte("billcaseid", 990999));
  ok(await db.from("tblbills").delete().gte("billcaseid", 990900).lte("billcaseid", 990999));
  ok(await db.from("tblcase").delete().gte("caseid", 990900).lte("caseid", 990999));
};
const bill = async (id) => ok(await db.from("tblbills").select("*").eq("billid", id).single());
const caseBills = async () => ok(await db.from("tblbills").select("billid").eq("billcaseid", CASE));
const addBill = async (o = {}) => ok(await db.from("tblbills").insert({ billcaseid: CASE, billdate: "2026-08-03", billhours: 3.25, billbalance: 812.5, billtype: "timesheet", billnotice: "2nd", billsecondnoticedate: "2026-08-20", billestimate: true, billcomments: "live qa", billfilename: "live-qa-B", ...o }).select("billid").single()).billid;
const addAct = async (h, o = {}) => ok(await db.from("tblactivity").insert({ actcaseid: CASE, actdate: "2026-08-01", actdescription: `revise live ${h}`, acthrs: h, actwho: 1, actbilled: true, ...o }).select("actid").single()).actid;
const actBill = async (ids) => ok(await db.from("tblactivity").select("actid, actbillid").in("actid", ids).order("actid")).map((r) => r.actbillid);

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
const reviseBtn = (page) => page.getByRole("button", { name: "Revise", exact: true });
const field = (page, name) => page.locator(`dd[data-field="${name}"]`).innerText();

before(async () => {
  if (skip) return;
  db = createServerClient();
  await cleanup();
  const src = ok(await db.from("tblcase").select("*").eq("caseid", 90001).single());
  ok(await db.from("tblcase").insert({ ...src, caseid: CASE }));
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

test("click Revise: redirect to /bills/<B′>, B′ copies B, rows moved, other bill's row untouched, B only Cancelled, links both ways, unbilled hours unchanged", { skip }, async () => {
  const B = await addBill();
  const other = await addBill({ billnotice: "1st", billsecondnoticedate: null, billfilename: "live-qa-other" });
  const a1 = await addAct("1.250", { actbillid: B });
  const a2 = await addAct("2.000", { actbillid: B });
  const a3 = await addAct("0.500", { actbillid: other });
  await addAct("0.750", { actbilled: false, actbillid: null });
  const beforeB = await bill(B);
  const unbilledBefore = unbilledHours(await listCaseTime(db, CASE));

  await admin.goto(`/bills/${B}`);
  await reviseBtn(admin).click();
  await admin.waitForURL((u) => /^\/bills\/\d+$/.test(u.pathname) && u.pathname !== `/bills/${B}` && !u.search);
  const B2 = Number(new URL(admin.url()).pathname.split("/").pop());
  const n = await bill(B2);
  assert.deepEqual(
    [n.billcaseid, n.billtype, Number(n.billhours), Number(n.billbalance), n.billestimate, n.billcomments, n.billnotice, n.supersedesbillid],
    [CASE, "timesheet", 3.25, 812.5, true, "live qa", "1st", B],
  );
  assert.notEqual(n.billfilename, "live-qa-B");
  assert.deepEqual(await actBill([a1, a2, a3]), [B2, B2, other]);
  assert.deepEqual(await bill(B), { ...beforeB, billnotice: "Cancelled" });
  assert.equal(unbilledHours(await listCaseTime(db, CASE)), unbilledBefore);
  assert.equal(unbilledBefore, "0.750");

  assert.equal(await field(admin, "Status"), "1st");
  const revises = admin.getByRole("link", { name: `Revises #${B}` });
  assert.equal(await revises.getAttribute("href"), `/bills/${B}`);
  await revises.click();
  await admin.waitForURL((u) => u.pathname === `/bills/${B}`);
  const revisedBy = admin.getByRole("link", { name: `Revised by #${B2}` });
  assert.equal(await revisedBy.getAttribute("href"), `/bills/${B2}`);
  assert.equal(await reviseBtn(admin).count(), 0, "no Revise on superseded, cancelled B");
});

test("captured Revise POST replayed: second revise refused, no bill inserted, rows stay on B′; staff sees no Revise and staff replay is refused", { skip }, async () => {
  const B = await addBill();
  const a1 = await addAct("1.000", { actbillid: B });
  await admin.goto(`/bills/${B}`);
  const cap = await clickCapture(admin, reviseBtn(admin));
  await admin.waitForURL((u) => u.pathname !== `/bills/${B}`);
  const B2 = Number(new URL(admin.url()).pathname.split("/").pop());
  const count = (await caseBills()).length;
  const bAfter = await bill(B);

  assert.match(await replay(admin, cap), new RegExp(`/bills/${B}\\?error=`), "second revise");
  assert.equal((await caseBills()).length, count);
  assert.deepEqual(await actBill([a1]), [B2]);
  assert.deepEqual(await bill(B), bAfter);

  // Make B revisable again (open, unsuperseded, row back on it) so only the admin check can refuse the staff replay.
  ok(await db.from("tblactivity").update({ actbillid: B }).eq("actid", a1));
  ok(await db.from("tblbills").update({ supersedesbillid: null }).eq("billid", B2));
  ok(await db.from("tblbills").update({ billnotice: "2nd" }).eq("billid", B));
  await staff.goto(`/bills/${B}`);
  assert.equal(await field(staff, "Status"), "2nd");
  assert.equal(await reviseBtn(staff).count(), 0, "staff sees no Revise");
  const open = await bill(B);
  assert.match(await replay(staff, cap), new RegExp(`/bills/${B}\\?error=forbidden`), "staff replay");
  assert.equal((await caseBills()).length, count);
  assert.deepEqual(await bill(B), open);
  assert.deepEqual(await actBill([a1]), [B]);
  // Control: the same POST from the admin now succeeds, so the staff refusal was the admin check, not a stale B.
  assert.match(await replay(admin, cap), /^\/bills\/\d+$/, "admin control replay");
  assert.equal((await caseBills()).length, count + 1);
});
