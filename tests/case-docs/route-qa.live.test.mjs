// Item 3 QA (live): edge cases of GET /cases/[id]/documents/[doc] through the real dev server (BASE_URL) and the
// LOCAL Supabase stack, signed in via the real login form. Own rows: firm/attorney/case 992931 (two-line firm
// address, a title that stresses XML escaping) and case 992932 (caseatty → a missing attorney); removed at setup and in after().
// 999999999 and 992939 never exist. Invented data only. Skips without the server or the service role.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import JSZip from "jszip";
import { chromium } from "@playwright/test";
import { loadEnvLocal, seedStaffE2e, seedAdminE2e } from "../app-shell/seed-e2e.ts";
import { createServerClient } from "../../lib/db/client.ts";
import { CASE_DOCS } from "../../lib/case-docs/docs.ts";

loadEnvLocal();
const BASE = process.env.BASE_URL ?? "http://localhost:3150";
const LOCAL = /^https?:\/\/(127\.0\.0\.1|localhost)[:/]/.test(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "");
const up = LOCAL && await fetch(`${BASE}/login`).then((r) => r.ok, () => false);
const skip = up && process.env.SUPABASE_SERVICE_ROLE_KEY ? false : "dev server or local Supabase unavailable";
const CASE = 992931, NOATTY = 992932;
const TITLE = `Example & Sons <LLP> v. "Sample" 'Q'`;
const STAFF = [process.env.E2E_EMAIL ?? "staff@example.test", process.env.E2E_PASSWORD ?? "password"];
const ADMIN = [process.env.E2E_ADMIN_EMAIL ?? "admin@example.test", process.env.E2E_ADMIN_PASSWORD ?? "password"];
const DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const LABEL = { "memo": "Memo", "cta-report": "CTA Report", "file-review-summary": "File Review Summary", "inspection-plan": "Inspection Plan" };
let db, browser, staff, admin;
const ok = ({ data, error }) => { if (error) throw new Error(error.message); return data; };
const cleanup = async () => {
  ok(await db.from("tblcase").delete().in("caseid", [CASE, NOATTY]));
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
/** document.xml, then every page header/footer part — the Inspection Plan's values are in its header. */
const docXml = async (buf) => {
  const zip = await JSZip.loadAsync(buf);
  const parts = ["word/document.xml", ...Object.keys(zip.files).filter((p) => /^word\/(header|footer)\d*\.xml$/.test(p))];
  return (await Promise.all(parts.map((p) => zip.file(p).async("string")))).join("\n");
};
const docText = (xml) => xml.replace(/<w:br\/>/g, "\n").replace(/<[^>]+>/g, "")
  .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");
const get = (who, path) => who.request.get(path, { maxRedirects: 0 });

before(async () => {
  if (skip) return;
  db = createServerClient();
  await cleanup();
  ok(await db.from("tblfirm").insert({ frmid: CASE, frmname: "Sample & Partners <PLLC>", frmaddress1: "12 Example Ave", frmaddress2: "Floor 3", frmcity: "Testville", frmstate: "NY", frmzip: "10001", frmactive: true }));
  ok(await db.from("tblattorney").insert({ attyid: CASE, attyfirmid: CASE, attytitle: "Ms.", attyfirstname: "Alex", attymiddlename: "", attylastname: "Sample", attysuffix: "", attyesq: false, attyemail: "alex@example.test" }));
  const src = ok(await db.from("tblcase").select("*").eq("caseid", 90001).single());
  ok(await db.from("tblcase").insert([
    { ...src, caseid: CASE, caseatty: CASE, casecaption: "Docket A-1 & B", casetitle: TITLE },
    { ...src, caseid: NOATTY, caseatty: CASE, casecaption: "No Atty Caption", casetitle: "Nobody v. Example" },
  ]));
  // caseatty is NOT NULL; a migrated row can still point at no attorney (NOT VALID FK) — reproduce that via psql.
  const r = spawnSync("psql", [process.env.DATABASE_URL, "-v", "ON_ERROR_STOP=1", "-c",
    `begin; set local session_replication_role = replica; update tblcase set caseatty = 992939 where caseid = ${NOATTY}; commit;`], { encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  await seedStaffE2e(db, ...STAFF);
  await seedAdminE2e(db, ...ADMIN);
  browser = await chromium.launch();
  staff = await signIn(STAFF);
  admin = await signIn(ADMIN);
});
after(async () => { await browser?.close(); if (db) await cleanup(); });

test("staff and admin: escaping title, two-line address and filename survive end to end, XML still well-formed", { skip }, async () => {
  const want = {
    "memo": ["Ms. Alex Sample", "Sample & Partners <PLLC>", "12 Example Ave\nFloor 3\nTestville, NY 10001", `Docket A-1 & B, ${TITLE}`],
    "cta-report": [TITLE, String(CASE), "Sample & Partners <PLLC>\n12 Example Ave\nFloor 3"],
    "file-review-summary": [TITLE, String(CASE)],
    "inspection-plan": [TITLE, String(CASE)],
  };
  for (const who of [staff, admin]) {
    for (const d of CASE_DOCS) {
      const res = await get(who, `/cases/${CASE}/documents/${d.slug}`);
      assert.equal(res.status(), 200, d.slug);
      assert.equal(res.headers()["content-type"], DOCX);
      assert.equal(res.headers()["cache-control"], "private, no-store");
      const file = `${LABEL[d.slug]} ${CASE}.docx`;
      assert.equal(res.headers()["content-disposition"], `attachment; filename="${file}"; filename*=UTF-8''${file.replace(/ /g, "%20")}`);
      const xml = await docXml(await res.body());
      // Raw, unescaped markup from the data must never appear in the XML.
      assert.ok(!xml.includes("<LLP>") && !xml.includes("<PLLC>") && !/&(?!(amp|lt|gt|quot|apos|#\d+|#x[0-9a-fA-F]+);)/.test(xml), `${d.slug}: unescaped text in document.xml`);
      const text = docText(xml);
      for (const v of want[d.slug]) assert.ok(text.includes(v), `${d.slug}: missing ${JSON.stringify(v)}`);
    }
  }
});

test("case with no attorney still downloads (empty Atty/Firm/Address, TitleCaption filled)", { skip }, async () => {
  const res = await get(staff, `/cases/${NOATTY}/documents/memo`);
  assert.equal(res.status(), 200);
  assert.ok(docText(await docXml(await res.body())).includes("No Atty Caption, Nobody v. Example"));
  assert.equal((await get(staff, `/cases/${NOATTY}/documents/cta-report`)).status(), 200);
});

test("id edge cases: huge ids, >9 digits, negative, decimal, leading zeros → 404 or the canonical case", { skip }, async () => {
  for (const id of ["999999999", "9999999999", "99999999999999999999", "-1", "1.5", "0x10", "%20992931", "0"]) {
    const res = await get(staff, `/cases/${id}/documents/memo`);
    assert.equal(res.status(), 404, `id ${JSON.stringify(id)} → ${res.status()}`);
    assert.match(res.headers()["content-type"] ?? "", /^text\/(plain|html)/, id);
    assert.ok(!res.headers()["content-disposition"], id);
    assert.notEqual((await res.body()).subarray(0, 2).toString(), "PK", id);
  }
  // Leading zeros resolve to the same case; the file name carries the canonical id, not the typed one.
  const res = await get(staff, `/cases/00${CASE}/documents/memo`);
  assert.equal(res.status(), 200);
  assert.match(res.headers()["content-disposition"], new RegExp(`filename="Memo ${CASE}\\.docx"`));
});

test("slug edge cases: case variants, trailing junk, label text → 404 plain", { skip }, async () => {
  for (const slug of ["Memo", "MEMO", "memo.docx", "memo%20", "CTA%20Report", "cta_report", "constructor", "__proto__", "toString"]) {
    const res = await get(staff, `/cases/${CASE}/documents/${slug}`);
    assert.equal(res.status(), 404, `slug ${slug} → ${res.status()}`);
    assert.match(res.headers()["content-type"] ?? "", /^text\/plain/, slug);
    assert.ok((await res.text()).length > 0, slug);
  }
});

test("HEAD signed in → no document body; POST → not a document; signed out HEAD/POST → login", { skip }, async () => {
  const head = await staff.request.head(`/cases/${CASE}/documents/memo`, { maxRedirects: 0 });
  assert.ok([200, 405].includes(head.status()), `HEAD ${head.status()}`);
  assert.equal((await head.body()).length, 0);
  const post = await staff.request.post(`/cases/${CASE}/documents/memo`, { maxRedirects: 0 });
  assert.equal(post.status(), 405, `POST ${post.status()}`);
  assert.notEqual((await post.body()).subarray(0, 2).toString(), "PK");
  for (const method of ["HEAD", "POST"]) {
    const res = await fetch(`${BASE}/cases/${CASE}/documents/memo`, { method, redirect: "manual" });
    assert.ok([303, 307].includes(res.status), `${method} ${res.status}`);
    assert.match(res.headers.get("location") ?? "", /^\/login|\/login\?/);
  }
});
