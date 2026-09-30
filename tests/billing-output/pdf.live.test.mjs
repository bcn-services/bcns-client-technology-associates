/**
 * Live check of the invoice PDF (billing-output item 4) through the real dev server (BASE_URL, default
 * http://localhost:3150): Finalize stores the PDF, Create PDF makes one for a bill without, the download route serves
 * application/pdf to a signed-in user and the login redirect to anon. Skips without the server or the service role.
 * Own rows on invented case 992320 (copy of case 90001's tblcase row); rows and bills/9923xx storage objects are removed
 * at setup and in after().
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
const ADMIN_EMAIL = `bill-pdf-admin-${randomUUID().slice(0, 8)}@example.test`;
const ADMIN_PASSWORD = `pw-${randomUUID()}`;
const up = await fetch(`${BASE}/login`).then((r) => r.ok, () => false);
const skip = up && process.env.SUPABASE_SERVICE_ROLE_KEY ? false : "dev server or Supabase unavailable";
const CASE = 992320;
let db, browser, staff, admin, adminId;
const ok = ({ data, error }) => { if (error) throw new Error(error.message); return data; };
const bucket = () => db.storage.from("case-documents");
const cleanup = async () => {
  const dirs = (ok(await bucket().list("bills", { limit: 1000 })) ?? []).map((d) => d.name).filter((n) => /^9923\d\d$/.test(n));
  for (const d of dirs) {
    const keys = (ok(await bucket().list(`bills/${d}`, { limit: 1000 })) ?? []).map((f) => `bills/${d}/${f.name}`);
    if (keys.length) ok(await bucket().remove(keys));
  }
  const bills = ok(await db.from("tblbills").select("billid").gte("billcaseid", 992300).lte("billcaseid", 992399)).map((b) => b.billid);
  if (bills.length) ok(await db.from("tblbilllines").delete().in("billid", bills));
  ok(await db.from("tblactivity").delete().gte("actcaseid", 992300).lte("actcaseid", 992399));
  ok(await db.from("tblfundsrcvd").delete().gte("fndscaseid", 992300).lte("fndscaseid", 992399));
  ok(await db.from("tblbills").update({ supersedesbillid: null }).gte("billcaseid", 992300).lte("billcaseid", 992399));
  ok(await db.from("tblbills").delete().gte("billcaseid", 992300).lte("billcaseid", 992399));
  ok(await db.from("tblcase").delete().gte("caseid", 992300).lte("caseid", 992399));
};
const bill = async (id) => ok(await db.from("tblbills").select("*").eq("billid", id).single());
const addBill = async () => ok(await db.from("tblbills").insert({ billcaseid: CASE, billdate: "2026-09-07", billhours: 0, billbalance: 0, billtype: "timesheet", billnotice: "1st" }).select("billid").single()).billid;
const addAct = async (billid, h, who, date) => ok(await db.from("tblactivity").insert({ actcaseid: CASE, actdate: date, actdescription: `pdf live ${h}`, acthrs: h, actwho: who, actbilled: true, actbillid: billid }).select("actid").single());
const timesheet = async () => { const B = await addBill(); await addAct(B, "2.000", 1, "2026-08-10"); await addAct(B, "1.500", 2, "2026-08-11"); return B; };
const stored = async (key) => Buffer.from(await ok(await bucket().download(key)).arrayBuffer());

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
  ok(await db.from("tblcase").insert({ ...src, caseid: CASE, casestartdate: "2026-01-10" }));
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

test("Finalize stores the PDF at billpdfpath; staff downloads it as application/pdf; anon is redirected to login", { skip }, async () => {
  const B = await timesheet();
  await admin.goto(`/bills/${B}/finalize`);
  await admin.getByRole("button", { name: /save|finalize/i }).click();
  await admin.waitForURL((u) => u.pathname === `/bills/${B}` && u.search === "?saved=1");
  const b = await bill(B);
  assert.match(b.billfilename, new RegExp(`^Bill${CASE} .+ 2026 09 07-0$`));
  assert.equal(b.billpdfpath, `bills/${CASE}/${b.billfilename.normalize("NFKD").replace(/[^\w .()&$@=;:+,-]/g, "")}.pdf`);
  assert.equal((await stored(b.billpdfpath)).subarray(0, 5).toString(), "%PDF-");
  assert.equal(await admin.getByTestId("bill-pdf").count(), 1, "download link on the bill page");

  await staff.goto(`/bills/${B}`);
  assert.equal(await staff.getByTestId("bill-pdf").getAttribute("href"), `/bills/${B}/pdf`);
  const res = await staff.request.get(`/bills/${B}/pdf`);
  assert.equal(res.status(), 200);
  assert.equal(res.headers()["content-type"], "application/pdf");
  assert.deepEqual(Buffer.from(await res.body()), await stored(b.billpdfpath));

  const anon = await fetch(`${BASE}/bills/${B}/pdf`, { redirect: "manual" });
  assert.ok([401, 302, 303, 307].includes(anon.status), `anon status ${anon.status}`);
  if (anon.status !== 401) assert.match(anon.headers.get("location") ?? "", /\/login/);
  assert.notEqual(anon.headers.get("content-type"), "application/pdf");
});

test("Create PDF on a finalized bill without one: second bill same case/attorney/date gets the -1 name; staff sees no button", { skip }, async () => {
  const B = await timesheet();
  await admin.goto(`/bills/${B}/finalize`);
  await admin.getByRole("button", { name: /save|finalize/i }).click();
  await admin.waitForURL((u) => u.pathname === `/bills/${B}` && u.search === "?saved=1");
  const first = await bill(B);
  // Simulate a PDF that failed after Finalize: no path, no name.
  ok(await db.from("tblbills").update({ billpdfpath: null, billfilename: null }).eq("billid", B));
  await staff.goto(`/bills/${B}`);
  assert.equal(await staff.getByRole("button", { name: /create pdf/i }).count(), 0);
  assert.equal(await staff.getByTestId("bill-no-pdf").count(), 1);
  await admin.goto(`/bills/${B}`);
  await admin.getByRole("button", { name: /create pdf/i }).click();
  await admin.waitForURL((u) => u.search === "?saved=1");
  const b = await bill(B);
  assert.ok(b.billpdfpath);
  assert.ok(b.billfinalizedat === first.billfinalizedat);
  // The earlier test's bill on this case/date holds -0 (if it ran); otherwise this one takes -0.
  const others = ok(await db.from("tblbills").select("billfilename").eq("billcaseid", CASE).neq("billid", B)).map((r) => r.billfilename);
  assert.match(b.billfilename, others.some((n) => n?.endsWith("-0")) ? /-1$/ : /-0$/);
  assert.equal((await stored(b.billpdfpath)).subarray(0, 5).toString(), "%PDF-");
});
