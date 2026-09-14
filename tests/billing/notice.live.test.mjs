/**
 * Live check of the notice actions on /bills/[id] (billing item 4) through the real dev server (BASE_URL, default
 * http://localhost:3100) and the real advanceBillNotice / closeBillAs server actions. Skips without the server or
 * SUPABASE_SERVICE_ROLE_KEY. Own rows live on invented case 990801 (copy of case 90001's tblcase row); everything
 * on 990800–990899 is removed at setup and in after(). Throwaway admin created/deleted with the service role; the
 * E2E staff login is pinned to personid 1 in before() and restored in after(). Each test inserts its own bill and
 * captures its own POST — no test depends on another.
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
const ADMIN_EMAIL = `bill-notice-admin-${randomUUID().slice(0, 8)}@example.test`;
const ADMIN_PASSWORD = `pw-${randomUUID()}`;
const up = await fetch(`${BASE}/login`).then((r) => r.ok, () => false);
const skip = up && process.env.SUPABASE_SERVICE_ROLE_KEY ? false : "dev server or Supabase unavailable";
const CASE = 990801;
let db, browser, staff, admin, adminId, priorPersonId;
const ok = ({ data, error }) => { if (error) throw new Error(error.message); return data; };
const cleanup = async () => {
  ok(await db.from("tblbills").delete().gte("billcaseid", 990800).lte("billcaseid", 990899));
  ok(await db.from("tblcase").delete().gte("caseid", 990800).lte("caseid", 990899));
};
const row = async (id) => ok(await db.from("tblbills").select("*").eq("billid", id).single());
const addBill = async (o) => ok(await db.from("tblbills").insert({ billcaseid: CASE, billdate: "2026-08-14", billhours: 2, billbalance: 640, billtype: "timesheet", billnotice: "1st", ...o }).select("billid").single()).billid;
const setRow = async (id, o) => ok(await db.from("tblbills").update(o).eq("billid", id));
/** Firm date computed independently of the app: New York calendar date of `d`. */
const nyToday = (d = new Date()) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);

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
/** Clicks `button` on `page` and returns the captured server-action POST (next-action header + body). */
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
const field = (page, name) => page.locator(`dd[data-field="${name}"]`).innerText();
const advanceBtns = (page) => page.getByRole("button", { name: /^Advance to/ });

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

test("click Advance to 2nd then Advance to Final: dates stamped NY-today, second kept, Final shows no Advance button", { skip }, async () => {
  const id = await addBill({});
  const today = nyToday();
  await admin.goto(`/bills/${id}`);
  await admin.getByRole("button", { name: "Advance to 2nd" }).click();
  await admin.waitForURL((u) => u.searchParams.get("saved") === "1");
  assert.equal(await field(admin, "Status"), "2nd");
  let r = await row(id);
  assert.deepEqual([r.billnotice, r.billsecondnoticedate, r.billfinalnoticedate, r.billpaiddate], ["2nd", today, null, null]);
  await setRow(id, { billsecondnoticedate: "2026-08-20" }); // distinct stamp, so "unchanged" can't pass by coincidence
  await admin.goto(`/bills/${id}`);
  await admin.getByRole("button", { name: "Advance to Final" }).click();
  await admin.waitForURL((u) => u.searchParams.get("saved") === "1");
  r = await row(id);
  assert.deepEqual([r.billnotice, r.billsecondnoticedate, r.billfinalnoticedate, r.billpaiddate], ["Final", "2026-08-20", today, null]);
  await admin.reload();
  assert.equal(await field(admin, "Status"), "Final");
  assert.equal(await advanceBtns(admin).count(), 0);
  assert.equal(await admin.getByRole("button", { name: "Close bill" }).count(), 1);
});

test("Close as Cancelled on a 2nd bill: notice Cancelled, both notice dates unchanged, controls gone", { skip }, async () => {
  const id = await addBill({ billnotice: "2nd", billsecondnoticedate: "2026-07-01" });
  const before = await row(id);
  await admin.goto(`/bills/${id}`);
  await admin.getByLabel("Close as").selectOption("Cancelled");
  await admin.getByRole("button", { name: "Close bill" }).click();
  await admin.waitForURL((u) => u.searchParams.get("saved") === "1");
  const r = await row(id);
  assert.deepEqual({ ...r, billnotice: before.billnotice }, before, "only billnotice changed");
  assert.deepEqual([r.billnotice, r.billsecondnoticedate, r.billfinalnoticedate, r.billpaiddate], ["Cancelled", "2026-07-01", null, null]);
  assert.equal(await field(admin, "Status"), "Cancelled");
  assert.equal(await advanceBtns(admin).count(), 0);
  assert.equal(await admin.getByRole("button", { name: "Close bill" }).count(), 0);
});

test("captured Advance POST: duplicate → stale & unchanged; staff replay → forbidden & unchanged; concurrent pair → 2nd; Paid → unchanged", { skip }, async () => {
  const id = await addBill({});
  await admin.goto(`/bills/${id}`);
  const cap = await clickCapture(admin, admin.getByRole("button", { name: "Advance to 2nd" }));
  await admin.waitForURL((u) => u.searchParams.get("saved") === "1");
  const at2nd = await row(id);
  assert.equal(at2nd.billnotice, "2nd");

  assert.match(await replay(admin, cap), new RegExp(`/bills/${id}\\?error=stale`), "duplicate submit");
  assert.deepEqual(await row(id), at2nd);

  await setRow(id, { billnotice: "1st", billsecondnoticedate: null });
  const at1st = await row(id);
  assert.match(await replay(staff, cap), new RegExp(`/bills/${id}\\?error=forbidden`), "staff replay");
  assert.deepEqual(await row(id), at1st);

  const pair = await Promise.all([replay(admin, cap), replay(admin, cap)]);
  assert.deepEqual(pair.map((u) => u.replace(/^.*\?/, "")).sort(), ["error=stale", "saved=1"], JSON.stringify(pair));
  const r = await row(id);
  assert.deepEqual([r.billnotice, r.billfinalnoticedate], ["2nd", null]);

  await setRow(id, { billnotice: "Paid", billpaiddate: "2026-09-01", billsecondnoticedate: null });
  const paid = await row(id);
  assert.match(await replay(admin, cap), /error=(stale|move)/, "advance on Paid");
  assert.deepEqual(await row(id), paid);
});

test("captured Close-as POST: staff replay refused; replay onto a Paid row refused; row unchanged; Paid page has no controls", { skip }, async () => {
  const id = await addBill({ billnotice: "2nd", billsecondnoticedate: "2026-07-02" });
  await admin.goto(`/bills/${id}`);
  await admin.getByLabel("Close as").selectOption("Settled");
  const cap = await clickCapture(admin, admin.getByRole("button", { name: "Close bill" }));
  await admin.waitForURL((u) => u.searchParams.get("saved") === "1");
  assert.equal((await row(id)).billnotice, "Settled");

  await setRow(id, { billnotice: "2nd" });
  const at2nd = await row(id);
  assert.match(await replay(staff, cap), new RegExp(`/bills/${id}\\?error=forbidden`));
  assert.deepEqual(await row(id), at2nd);

  await setRow(id, { billnotice: "Paid", billpaiddate: "2026-09-01" });
  const paid = await row(id);
  assert.match(await replay(admin, cap), /error=(stale|move)/);
  assert.deepEqual(await row(id), paid);
  await admin.goto(`/bills/${id}`);
  assert.equal(await advanceBtns(admin).count(), 0);
  assert.equal(await admin.getByRole("button", { name: "Close bill" }).count(), 0);
  assert.equal(await admin.locator('[data-testid="bill-notice"]').count(), 0);
});

test("staff GET of an open 1st bill: no Advance, no Close bill, no Close-as select", { skip }, async () => {
  const id = await addBill({});
  await staff.goto(`/bills/${id}`);
  assert.equal(await field(staff, "Status"), "1st");
  assert.equal(await advanceBtns(staff).count(), 0);
  assert.equal(await staff.getByRole("button", { name: "Close bill" }).count(), 0);
  assert.equal(await staff.getByLabel("Close as").count(), 0);
});
