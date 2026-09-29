/**
 * QA gate for item 4 through the real dev server (BASE_URL, default http://localhost:3150) and the LOCAL Supabase stack:
 * each of the 6 bill types finalized with the real Finalize form → a PDF at billpdfpath whose text holds every stored
 * line and "Balance due" with the stored balance; admin and staff download application/pdf (same bytes as stored); anon
 * gets the login redirect and no PDF bytes; staff have no Create/Re-create button; Re-create keeps the path; a storage
 * failure after Finalize leaves the bill finalized and offers Create PDF. Skips without the server or service role.
 * Invented case 992360 (copy of seed case 90001); its rows and bills/99236x objects are removed at setup and in after().
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { inflateSync } from "node:zlib";
import { chromium } from "@playwright/test";
import { loadEnvLocal, seedE2eUser } from "../app-shell/seed-e2e.ts";
import { createServerClient } from "../../lib/db/client.ts";

loadEnvLocal();
const BASE = process.env.BASE_URL ?? "http://localhost:3150";
const ADMIN_EMAIL = `bill-pdf-qa-${randomUUID().slice(0, 8)}@example.test`;
const ADMIN_PASSWORD = `pw-${randomUUID()}`;
const up = await fetch(`${BASE}/login`).then((r) => r.ok, () => false);
const skip = up && process.env.SUPABASE_SERVICE_ROLE_KEY ? false : "dev server or Supabase unavailable";
const CASE = 992360;
let db, browser, staff, admin, adminId;
const ok = ({ data, error }) => { if (error) throw new Error(error.message); return data; };
const bucket = () => db.storage.from("case-documents");
const cleanup = async () => {
  const keys = (ok(await bucket().list(`bills/${CASE}`, { limit: 1000 })) ?? []).map((f) => `bills/${CASE}/${f.name}`);
  if (keys.length) ok(await bucket().remove(keys));
  const bills = ok(await db.from("tblbills").select("billid").eq("billcaseid", CASE)).map((b) => b.billid);
  if (bills.length) ok(await db.from("tblbilllines").delete().in("billid", bills));
  ok(await db.from("tblactivity").delete().eq("actcaseid", CASE));
  ok(await db.from("tblfundsrcvd").delete().eq("fndscaseid", CASE));
  ok(await db.from("tblbills").update({ supersedesbillid: null }).eq("billcaseid", CASE));
  ok(await db.from("tblbills").delete().eq("billcaseid", CASE));
  ok(await db.from("tblcase").delete().eq("caseid", CASE));
};
const getBill = async (id) => ok(await db.from("tblbills").select("*").eq("billid", id).single());
const lines = async (id) => ok(await db.from("tblbilllines").select("*").eq("billid", id).order("lineno"));
const addBill = async (billtype, o = {}) => ok(await db.from("tblbills").insert({ billcaseid: CASE, billdate: "2026-09-07", billhours: 0, billbalance: 0, billtype, billnotice: "1st", ...o }).select("billid").single()).billid;

const WIN = { 0x91: "‘", 0x92: "’", 0x93: "“", 0x94: "”", 0x96: "–", 0x97: "—" };
function pdfText(buf) {
  const out = [], s = buf.toString("latin1");
  for (const m of s.matchAll(/stream\r?\n/g)) {
    const a = m.index + m[0].length;
    let body;
    try { body = inflateSync(Buffer.from(s.slice(a, s.indexOf("endstream", a)), "latin1")); } catch { continue; }
    for (const t of body.toString("latin1").matchAll(/<([0-9A-Fa-f]*)> Tj/g)) out.push([...Buffer.from(t[1], "hex")].map((c) => WIN[c] ?? String.fromCharCode(c)).join(""));
  }
  return out;
}

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
async function finalize(B) {
  await admin.goto(`/bills/${B}/finalize`);
  await admin.getByRole("button", { name: /finalize bill/i }).click();
  await admin.waitForURL((u) => u.pathname === `/bills/${B}` && u.search === "?saved=1", { timeout: 60_000 });
}

before(async () => {
  if (skip) return;
  db = createServerClient();
  await cleanup();
  const src = ok(await db.from("tblcase").select("*").eq("caseid", 90001).single());
  ok(await db.from("tblcase").insert({ ...src, caseid: CASE, casestartdate: "2026-01-10", casecaption: "Invented QA Court" }));
  adminId = (await seedE2eUser(db, ADMIN_EMAIL, ADMIN_PASSWORD)).id;
  ok(await db.from("profiles").update({ role: "admin" }).eq("id", adminId));
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

for (const type of ["blank", "retainer", "timesheet", "depoprep", "depo", "trial"]) {
  test(`${type}: Finalize makes the PDF; its text holds every stored line and the stored balance; admin+staff get application/pdf, anon gets no bytes`, { skip }, async () => {
    const B = await addBill(type);
    if (type === "timesheet") {
      for (const [d, h, who] of [["2026-08-03", "2.250", 1], ["2026-08-04", "1.500", 1]]) ok(await db.from("tblactivity").insert({ actcaseid: CASE, actdate: d, actdescription: `qa pdf ${type} ${h}`, acthrs: h, actwho: who, actbilled: true, actbillid: B }));
      ok(await db.from("tblfundsrcvd").insert({ fndscaseid: CASE, fndsdate: "2026-08-01", fndspmt: "120.00", fndsbranch: "Stratford", fndstype: "Check", fndsbillid: B }));
    }
    await finalize(B);
    const b = await getBill(B);
    assert.ok(b.billfinalizedat && b.billpdfpath, `finalized with a PDF path: ${JSON.stringify(b)}`);
    assert.ok(b.billpdfpath.startsWith(`bills/${CASE}/`) && b.billpdfpath.endsWith(".pdf"));
    await admin.getByRole("link", { name: /download invoice pdf/i }).waitFor({ timeout: 30_000 }); // client-side redirect: URL changes before the page renders
  assert.equal(await admin.getByRole("link", { name: /download invoice pdf/i }).count(), 1);
    const stored = Buffer.from(await ok(await bucket().download(b.billpdfpath)).arrayBuffer());
    const t = pdfText(stored), all = t.join(" ");
    const ls = await lines(B);
    if (type !== "blank") assert.ok(ls.length > 0);
    for (const l of ls) assert.ok(all.includes(l.description), `${type}: missing line ${l.description}`);
    const i = t.indexOf("Balance due:");
    const bal = Math.round(Number(b.billbalance));
    assert.ok(i >= 0 && t[i + 1].startsWith(`$${bal.toLocaleString("en-US")}`), `${type}: balance ${t[i + 1]} vs stored ${b.billbalance}`);
    for (const who of [admin, staff]) {
      const res = await who.request.get(`/bills/${B}/pdf`);
      assert.equal(res.status(), 200);
      assert.equal(res.headers()["content-type"], "application/pdf");
      assert.deepEqual(Buffer.from(await res.body()), stored);
    }
    const anon = await fetch(`${BASE}/bills/${B}/pdf`, { redirect: "manual" });
    const body = Buffer.from(await anon.arrayBuffer());
    assert.ok([401, 302, 303, 307].includes(anon.status), `anon ${anon.status}`);
    if (anon.status !== 401) assert.match(anon.headers.get("location") ?? "", /\/login/);
    assert.ok(!body.includes("%PDF"), "anon received PDF bytes");
  });
}

test("staff see Download but no Create/Re-create PDF; admin Re-create keeps the path and the bill stays finalized", { skip }, async () => {
  const B = await addBill("retainer");
  await finalize(B);
  const before = await getBill(B);
  await staff.goto(`/bills/${B}`);
  await staff.getByRole("link", { name: /download invoice pdf/i }).waitFor({ timeout: 30_000 });
  assert.equal(await staff.getByRole("link", { name: /download invoice pdf/i }).count(), 1);
  assert.equal(await staff.getByRole("button", { name: /create pdf/i }).count(), 0);
  await admin.goto(`/bills/${B}`);
  await admin.getByRole("button", { name: /re-create pdf/i }).click();
  await admin.waitForURL((u) => u.search === "?saved=1");
  const after = await getBill(B);
  assert.equal(after.billpdfpath, before.billpdfpath);
  assert.equal(after.billfinalizedat, before.billfinalizedat);
  assert.equal(after.billbalance, before.billbalance);
});

test("storage failure after Finalize: bill stays finalized with no PDF, admin is offered Create PDF, staff a note; Create PDF works once storage accepts it", { skip }, async () => {
  // A 300-character file name makes the local storage API reject the object key (HTTP 500) — a real storage failure.
  const B = await addBill("retainer", { billfilename: "Q".repeat(300) });
  await finalize(B);
  const b = await getBill(B);
  assert.ok(b.billfinalizedat, "bill un-finalized by a PDF failure");
  assert.equal(b.billpdfpath, null);
  await admin.getByRole("button", { name: /^create pdf$/i }).waitFor({ timeout: 30_000 });
  assert.equal(await admin.getByRole("button", { name: /^create pdf$/i }).count(), 1);
  await staff.goto(`/bills/${B}`);
  await staff.getByTestId("bill-no-pdf").waitFor({ timeout: 30_000 });
  assert.equal(await staff.getByTestId("bill-no-pdf").count(), 1);
  assert.equal(await staff.getByRole("button", { name: /create pdf/i }).count(), 0);
  await admin.getByRole("button", { name: /^create pdf$/i }).click();
  await admin.waitForURL((u) => u.search === "?error=pdf-failed");
  assert.match(await admin.locator("body").innerText(), /invoice PDF could not be made/i);
  ok(await db.from("tblbills").update({ billfilename: null }).eq("billid", B));
  await admin.goto(`/bills/${B}`);
  await admin.getByRole("button", { name: /^create pdf$/i }).click();
  await admin.waitForURL((u) => u.search === "?saved=1");
  assert.ok((await getBill(B)).billpdfpath);
});
