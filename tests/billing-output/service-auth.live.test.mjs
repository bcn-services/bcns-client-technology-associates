/**
 * Live check of item 7 (service authorization document + legacy approval-date rule) against the local stack: the real
 * storage bucket and tables, then the dev server (BASE_URL, default http://localhost:3150) for Create SA, the download
 * route and /cases/service-auths. Skips without the server or the service role. Own rows on invented case 992701 with
 * an invented attorney/firm; rows and service-auths/9927xx objects are removed at setup and in after().
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { inflateSync } from "node:zlib";
import { chromium } from "@playwright/test";
import { loadEnvLocal } from "../app-shell/seed-e2e.ts";
import { createServerClient } from "../../lib/db/client.ts";
import { createServiceAuth, saStore } from "../../lib/bill-docs/service-auth.ts";
import { SA_FIELDS, saValue, saveServiceAuth, serviceAuthList, saKey } from "../../lib/cases/service-auths.ts";
import { firmToday } from "../../lib/cases/presets.ts";

loadEnvLocal();
const BASE = process.env.BASE_URL ?? "http://localhost:3150";
const up = await fetch(`${BASE}/login`).then((r) => r.ok, () => false);
const skip = up && process.env.SUPABASE_SERVICE_ROLE_KEY ? false : "dev server or Supabase unavailable";
const CASE = 992701, ATTY = 992701, FIRM = 992701;
const CFG = { letterhead: ["Sample Consulting Co.", "1 Nowhere Plaza"], taxId: "00-0000000" };
let db, browser;
const ok = ({ data, error }) => { if (error) throw new Error(error.message); return data; };
const bucket = () => db.storage.from("case-documents");
const cleanup = async () => {
  const dirs = (ok(await bucket().list("service-auths", { limit: 1000 })) ?? []).map((d) => d.name).filter((n) => /^9927\d\d$/.test(n));
  for (const d of dirs) {
    const keys = (ok(await bucket().list(`service-auths/${d}`, { limit: 1000 })) ?? []).map((f) => `service-auths/${d}/${f.name}`);
    if (keys.length) ok(await bucket().remove(keys));
  }
  ok(await db.from("tblsrvauth").delete().gte("srvauthcaseid", 992700).lte("srvauthcaseid", 992799));
  ok(await db.from("tblactivity").delete().gte("actcaseid", 992700).lte("actcaseid", 992799));
  ok(await db.from("tblcase").delete().gte("caseid", 992700).lte("caseid", 992799));
  ok(await db.from("tblattorney").delete().eq("attyid", ATTY));
  ok(await db.from("tblfirm").delete().eq("frmid", FIRM));
};
const stored = async (key) => Buffer.from(await ok(await bucket().download(key)).arrayBuffer());
function pdfText(buf) {
  const out = [];
  const s = buf.toString("latin1");
  for (const m of s.matchAll(/stream\r?\n/g)) {
    const start = m.index + m[0].length;
    let body = Buffer.from(s.slice(start, s.indexOf("endstream", start)), "latin1");
    try { body = inflateSync(body); } catch { continue; }
    for (const t of body.toString("latin1").matchAll(/<([0-9A-Fa-f]*)> Tj/g)) out.push(Buffer.from(t[1], "hex").toString("latin1"));
  }
  return out.join("\n");
}
const sa = async (id) => ok(await db.from("tblsrvauth").select("*").eq("srvauthid", id).single());
function editForm(row, overrides) {
  const f = new FormData();
  f.set("srvauthid", String(row.srvauthid));
  for (const fl of SA_FIELDS) { f.set(fl.col, saValue(fl, row)); f.set(`${fl.col}__orig`, saValue(fl, row)); }
  for (const [k, v] of Object.entries(overrides)) f.set(k, v);
  return f;
}
const inList = async (kind, id) => (await serviceAuthList(db, kind)).find((r) => r.srvauthid === id);

before(async () => {
  if (skip) return;
  db = createServerClient();
  await cleanup();
  ok(await db.from("tblfirm").insert({ frmid: FIRM, frmname: "Placeholder & Sample LLP", frmphone: "0005550100", frmactive: true }));
  ok(await db.from("tblattorney").insert({ attyid: ATTY, attyfirmid: FIRM, attyfirstname: "Rowan", attylastname: "O'Test-wood" }));
  const src = ok(await db.from("tblcase").select("*").eq("caseid", 90001).single());
  ok(await db.from("tblcase").insert({ ...src, caseid: CASE, caseatty: ATTY, casestartdate: "2026-01-10", casecaption: "Live Sample Caption", casetitle: "Live v. Fixture" }));
  const act = (actdate, acthrs, actdescription, extra = {}) => ({ actcaseid: CASE, actdate, acthrs, actdescription, actwho: 1, actbilled: false, actbillid: null, ...extra });
  ok(await db.from("tblactivity").insert([
    act("2026-08-10", "2.000", "Reviewed invented deposition"),
    act("2026-08-11", "1.250", "Drafted sample memo"),
    act("2026-08-09", "7.000", "ALREADY BILLED live", { actbilled: true }),
  ]));
});
after(async () => {
  await browser?.close();
  if (db) await cleanup();
});

test("done-when: Create SA stores a PDF with caption, case #, rate and each unbilled row; Awaiting Approval row's srvauthfile names the object; the next one is -1", { skip }, async () => {
  const today = firmToday(new Date());
  const r = await createServiceAuth(db, saStore(), CASE, new Date(), CFG);
  const base = `SA${CASE} OTest wood ${today.replaceAll("-", " ")}`;
  assert.equal(r.srvauthfile, `${base}-0`);
  const row = await sa(r.srvauthid);
  assert.deepEqual([row.srvauthcaseid, String(row.srvauthdate).slice(0, 10), Number(row.srvauthhours), row.srvauthstatus, row.srvauthfile, row.srvdateapproved],
    [CASE, today, 3.25, "Awaiting Approval", `${base}-0`, null]);
  const text = pdfText(await stored(saKey(CASE, row.srvauthfile)));
  for (const s of ["Live Sample Caption / Live v. Fixture / #992701", "Rowan O'Test-wood, Esq. / (000) 555-0100", "$435/hr",
    "8/10/26", "Reviewed invented deposition", "2.00", "8/11/26", "Drafted sample memo", "1.25"]) assert.ok(text.includes(s), `missing "${s}"`);
  assert.ok(!text.includes("ALREADY BILLED"));

  // The real bucket refuses an overwrite (upload upsert:false) and create() reports it as taken, bytes untouched.
  const key = saKey(CASE, row.srvauthfile);
  const before = await stored(key);
  assert.equal(await saStore().create(key, new Uint8Array([1, 2, 3])), false);
  assert.ok((await stored(key)).equals(before));
  const r2 = await createServiceAuth(db, saStore(), CASE, new Date(), CFG);
  assert.equal(r2.srvauthfile, `${base}-1`);
});

test("done-when: Declined stamps today, Awaiting Approval clears it, Approved keeps a date; the lists follow", { skip }, async () => {
  const today = firmToday(new Date());
  const { srvauthid: id } = await createServiceAuth(db, saStore(), CASE, new Date(), CFG);
  assert.ok(await inList("unapproved", id), "new SA is pending");

  await saveServiceAuth(db, CASE, editForm(await sa(id), { srvauthstatus: "Declined" }), today);
  assert.equal(String((await sa(id)).srvdateapproved).slice(0, 10), today);
  assert.ok(!(await inList("unapproved", id)) && !(await inList("approved", id)), "Declined leaves both lists");

  await saveServiceAuth(db, CASE, editForm(await sa(id), { srvauthstatus: "Awaiting Approval" }), today);
  assert.equal((await sa(id)).srvdateapproved, null);
  assert.ok(await inList("awaiting", id), "back to pending");

  ok(await db.from("tblsrvauth").update({ srvdateapproved: "2026-02-03" }).eq("srvauthid", id));
  await saveServiceAuth(db, CASE, editForm(await sa(id), { srvauthstatus: "Approved" }), today);
  assert.equal(String((await sa(id)).srvdateapproved).slice(0, 10), "2026-02-03");
  const listed = await inList("approved", id);
  assert.equal(listed?.approvedDate, "2026-02-03");
  assert.ok(!(await inList("unapproved", id)));
});

test("browser: staff clicks Create SA, downloads application/pdf; /cases/service-auths lists it; anon is sent to login", { skip }, async () => {
  browser = await chromium.launch();
  const ctx = await browser.newContext({ baseURL: BASE, acceptDownloads: true });
  const page = await ctx.newPage();
  for (let i = 0; ; i++) {
    await page.goto("/login");
    await page.getByLabel(/email/i).fill(process.env.E2E_EMAIL ?? "staff@example.test");
    await page.getByLabel(/password/i).fill(process.env.E2E_PASSWORD ?? "password");
    await page.getByRole("button", { name: /sign in/i }).click();
    try { await page.waitForURL((u) => u.pathname !== "/login", { timeout: 20_000 }); break; } catch (e) { if (i >= 4) throw e; await page.waitForTimeout(3000 * (i + 1)); }
  }
  await page.goto(`/cases/${CASE}`, { timeout: 90_000 });
  await page.getByRole("button", { name: "Create SA" }).click();
  const created = page.getByTestId("sa-created");
  await created.waitFor({ timeout: 90_000 });
  const id = Number(new URL(page.url()).searchParams.get("sa_new"));
  const row = await sa(id);
  assert.equal(row.srvauthstatus, "Awaiting Approval");
  const [dl] = await Promise.all([page.waitForEvent("download"), created.getByRole("link").click()]);
  assert.equal(dl.suggestedFilename(), `${row.srvauthfile}.pdf`);
  const res = await page.request.get(`/cases/service-auths/pdf/${id}`);
  assert.equal(res.status(), 200);
  assert.equal(res.headers()["content-type"], "application/pdf");
  assert.ok((await res.body()).subarray(0, 5).toString() === "%PDF-");

  await page.goto("/cases/service-auths", { timeout: 90_000 });
  assert.ok((await page.content()).includes(String(id)), "new SA on the pending list");

  const anon = await fetch(`${BASE}/cases/service-auths/pdf/${id}`, { redirect: "manual" });
  assert.ok([302, 303, 307].includes(anon.status) && /\/login/.test(anon.headers.get("location") ?? ""), `anon got ${anon.status}`);
});
