// Item 3 (live): GET /cases/[id]/documents/[doc] through the real dev server (BASE_URL, default http://localhost:3150)
// and the LOCAL Supabase stack. Signed in as the seeded E2E staff (and admin) accounts via the real login form.
// Own rows: firm/attorney/case 992811 (copy of seed case 90001), removed at setup and in after(); 992819 never exists.
// Invented data only. Skips without the server or the service role.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import JSZip from "jszip";
import { chromium } from "@playwright/test";
import { loadEnvLocal, seedStaffE2e, seedAdminE2e } from "../app-shell/seed-e2e.ts";
import { createServerClient } from "../../lib/db/client.ts";
import { CASE_DOCS, todayText } from "../../lib/case-docs/docs.ts";

loadEnvLocal();
const BASE = process.env.BASE_URL ?? "http://localhost:3150";
const LOCAL = /^https?:\/\/(127\.0\.0\.1|localhost)[:/]/.test(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "");
const up = LOCAL && await fetch(`${BASE}/login`).then((r) => r.ok, () => false);
const skip = up && process.env.SUPABASE_SERVICE_ROLE_KEY ? false : "dev server or local Supabase unavailable";
const CASE = 992811, MISSING = 992819;
const TITLE = `Example & Co <v.> "Sample"`;
const STAFF = [process.env.E2E_EMAIL ?? "staff@example.test", process.env.E2E_PASSWORD ?? "password"];
const ADMIN = [process.env.E2E_ADMIN_EMAIL ?? "admin@example.test", process.env.E2E_ADMIN_PASSWORD ?? "password"];
const DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
let db, browser, staff, admin;
const ok = ({ data, error }) => { if (error) throw new Error(error.message); return data; };
const cleanup = async () => {
  ok(await db.from("tblcase").delete().eq("caseid", CASE));
  ok(await db.from("tblattorney").delete().eq("attyid", CASE));
  ok(await db.from("tblfirm").delete().eq("frmid", CASE));
};

async function signIn([email, password]) {
  const page = await (await browser.newContext({ baseURL: BASE })).newPage();
  for (let i = 0; ; i++) {
    await page.goto("/login");
    await page.getByLabel(/email/i).fill(email);
    await page.getByLabel(/password/i).fill(password);
    await page.getByRole("button", { name: /sign in/i }).click();
    try { await page.waitForURL((u) => u.pathname !== "/login", { timeout: 20_000 }); break; } catch (e) { if (i >= 4) throw e; await page.waitForTimeout(3000 * (i + 1)); }
  }
  return page;
}
/** The document's visible text: w:br → newline, tags dropped, the five XML entities decoded. */
const docText = async (buf) => (await (await JSZip.loadAsync(buf)).file("word/document.xml").async("string"))
  .replace(/<w:br\/>/g, "\n").replace(/<[^>]+>/g, "")
  .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");

before(async () => {
  if (skip) return;
  db = createServerClient();
  await cleanup();
  ok(await db.from("tblfirm").insert({ frmid: CASE, frmname: "Example Firm LLP", frmaddress1: "1 Test St", frmaddress2: "Suite 2", frmcity: "Sampletown", frmstate: "NY", frmzip: "100019999", frmactive: true }));
  ok(await db.from("tblattorney").insert({ attyid: CASE, attyfirmid: CASE, attytitle: "Mr.", attyfirstname: "Pat", attymiddlename: "Quinn", attylastname: "Example", attysuffix: "Jr.", attyesq: true, attyemail: "pat@example.test" }));
  const src = ok(await db.from("tblcase").select("*").eq("caseid", 90001).single());
  ok(await db.from("tblcase").insert({ ...src, caseid: CASE, caseatty: CASE, casecaption: "Index No. 000/0000", casetitle: TITLE }));
  await seedStaffE2e(db, ...STAFF);
  await seedAdminE2e(db, ...ADMIN);
  browser = await chromium.launch();
  staff = await signIn(STAFF);
  admin = await signIn(ADMIN);
});
after(async () => { await browser?.close(); if (db) await cleanup(); });

test("case page shows the four document links, same for staff and admin, in CASE_DOCS order", { skip }, async () => {
  const want = CASE_DOCS.map((d) => [d.label, `/cases/${CASE}/documents/${d.slug}`]);
  for (const who of [staff, admin]) {
    await who.goto(`/cases/${CASE}`);
    await who.getByRole("link", { name: "Rolodex card" }).waitFor({ timeout: 30_000 });
    const got = await who.locator("a[href*='/documents/']").evaluateAll((as) => as.map((a) => [a.textContent, a.getAttribute("href")]));
    assert.deepEqual(got, want);
  }
});

test("signed-in staff: each link downloads a .docx named for the case holding the case's values", { skip }, async () => {
  const today = todayText(new Date());
  const expect = {
    "memo": ["Pat Q. Example, Jr., Esq.", "Example Firm LLP", "1 Test St\nSuite 2\nSampletown, NY 10001-9999", today, `Index No. 000/0000, ${TITLE}`],
    "cta-report": ["Pat Quinn Example, Jr., Esq.\nExample Firm LLP\n1 Test St\nSuite 2\nSampletown, NY 100019999", TITLE, String(CASE)],
    "file-review-summary": [TITLE, String(CASE), today],
    "inspection-plan": ["Additional notes:"], // no bookmarks filled — the template's own text comes through
  };
  const names = { "memo": "Memo", "cta-report": "CTA Report", "file-review-summary": "File Review Summary", "inspection-plan": "Inspection Plan" };
  for (const d of CASE_DOCS) {
    const res = await staff.request.get(`/cases/${CASE}/documents/${d.slug}`, { maxRedirects: 0 });
    assert.equal(res.status(), 200, d.slug);
    assert.equal(res.headers()["content-type"], DOCX, d.slug);
    assert.equal(res.headers()["cache-control"], "private, no-store", d.slug);
    const cd = res.headers()["content-disposition"];
    const file = `${names[d.slug]} ${CASE}.docx`;
    assert.ok(cd.startsWith("attachment;"), cd);
    assert.ok(cd.includes(`filename="${file}"`), cd);
    assert.ok(cd.includes(`filename*=UTF-8''${encodeURIComponent(file)}`), cd);
    const text = await docText(await res.body());
    for (const v of expect[d.slug]) assert.ok(text.includes(v), `${d.slug}: missing ${JSON.stringify(v)}`);
  }
});

test("signed out: redirect to /login, no document bytes", { skip }, async () => {
  for (const d of CASE_DOCS) {
    const res = await fetch(`${BASE}/cases/${CASE}/documents/${d.slug}`, { redirect: "manual" });
    assert.ok([302, 303, 307, 308].includes(res.status), `${d.slug}: ${res.status}`);
    assert.match(res.headers.get("location") ?? "", /\/login/);
    assert.notEqual(res.headers.get("content-type"), DOCX);
    const body = Buffer.from(await res.arrayBuffer());
    assert.notEqual(body.subarray(0, 2).toString(), "PK", "zip bytes sent to an anonymous caller");
  }
});

test("unknown kind, non-numeric id, missing case → 404 plain text", { skip }, async () => {
  for (const path of [`/cases/${CASE}/documents/invoice`, `/cases/abc/documents/memo`, `/cases/${MISSING}/documents/memo`]) {
    const res = await staff.request.get(path, { maxRedirects: 0 });
    assert.equal(res.status(), 404, path);
    assert.match(res.headers()["content-type"] ?? "", /^text\/plain/, path);
    assert.ok(!res.headers()["content-disposition"], path);
    assert.ok((await res.text()).length > 0, path);
  }
});
