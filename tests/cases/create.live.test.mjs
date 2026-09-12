/**
 * Browser check of /cases/new through the real page and server actions (dev server at BASE_URL,
 * default http://localhost:3106). Skips when unreachable or Supabase is unconfigured.
 * Invented case numbers 990000+ and an invented attorney; all removed with the service role in after().
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { chromium } from "@playwright/test";
import { loadEnvLocal } from "../app-shell/seed-e2e.ts";
import { createServerClient } from "../../lib/db/client.ts";

loadEnvLocal();
const BASE = process.env.BASE_URL ?? "http://localhost:3106";
const up = await fetch(`${BASE}/login`).then((r) => r.ok, () => false);
const skip = up && process.env.SUPABASE_SERVICE_ROLE_KEY ? false : "dev server or Supabase unavailable";
const ATTY_LAST = "Inventednewcase990";
let db, browser, page, addedOpen = false;
const ok = ({ data, error }) => { if (error) throw new Error(error.message); return data; };
const cleanup = async () => {
  ok(await db.from("tblcase").delete().gte("caseid", 990000));
  ok(await db.from("tblattorney").delete().eq("attylastname", ATTY_LAST));
  if (addedOpen) ok(await db.from("tblcasestatus").delete().eq("casestatus", "Open"));
};
const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };

before(async () => {
  if (skip) return;
  db = createServerClient();
  await cleanup();
  // The legacy default status is "Open"; the hosted fixture lookup may lack it. Add it for this run only.
  const statuses = ok(await db.from("tblcasestatus").select("casestatus")).map((r) => r.casestatus.toLowerCase());
  if (!statuses.includes("open")) { ok(await db.from("tblcasestatus").insert({ casestatus: "Open" })); addedOpen = true; }
  browser = await chromium.launch();
  page = await browser.newPage({ baseURL: BASE });
  for (let i = 0; ; i++) { // shared project → auth 429s; back off
    await page.goto("/login");
    await page.getByLabel(/email/i).fill(process.env.E2E_EMAIL ?? "staff@example.test");
    await page.getByLabel(/password/i).fill(process.env.E2E_PASSWORD ?? "password");
    await page.getByRole("button", { name: /sign in/i }).click();
    try { await page.waitForURL((u) => u.pathname !== "/login", { timeout: 20_000 }); break; } catch (e) { if (i >= 4) throw e; await page.waitForTimeout(3000 * (i + 1)); }
  }
});
after(async () => { await browser?.close(); if (db) await cleanup(); });

const pickFirst = async (sel) => page.locator(sel).selectOption({ index: 1 });
async function fillAndSave(caseid) {
  await page.locator("#f-caseid").fill(String(caseid));
  await page.locator("#f-casesubject").fill("Invented subject");
  for (const s of ["#f-tabranch", "#f-caseatty", "#f-caseclient"]) if (!(await page.locator(s).inputValue())) await pickFirst(s);
  if (!(await page.locator("#f-status").inputValue())) await pickFirst("#f-status");
  await page.getByRole("button", { name: "Save case" }).click();
}

test("opens with max(caseid)+1 and the three legacy defaults; saving lands on the new record", { skip }, async () => {
  const [{ caseid: max }] = ok(await db.from("tblcase").select("caseid").order("caseid", { ascending: false }).limit(1));
  await page.goto("/cases/new");
  assert.equal(await page.locator("#f-caseid").inputValue(), String(max + 1));
  assert.equal(await page.locator("#f-casetitle").inputValue(), "TBD");
  assert.equal(await page.locator("#f-casestartdate").inputValue(), today());
  assert.equal((await page.locator("#f-status").inputValue()).toLowerCase(), "open");
  await fillAndSave(990501);
  await page.waitForURL(/\/cases\/990501$/);
  const row = ok(await db.from("tblcase").select("casetitle, casesubject, status, casestartdate").eq("caseid", 990501).single());
  assert.deepEqual({ ...row, status: row.status.toLowerCase() }, { casetitle: "TBD", casesubject: "Invented subject", status: "open", casestartdate: today() });
});

test("an existing case number shows 'Case number already exists' and inserts nothing", { skip }, async () => {
  const { count: before } = await db.from("tblcase").select("caseid", { count: "exact", head: true });
  await page.goto("/cases/new");
  await fillAndSave(990501);
  await page.getByRole("alert").filter({ hasText: "Case number already exists" }).waitFor();
  assert.match(page.url(), /\/cases\/new/);
  assert.equal(await page.locator("#f-casesubject").inputValue(), "Invented subject", "typed values kept");
  const { count: after } = await db.from("tblcase").select("caseid", { count: "exact", head: true });
  assert.equal(after, before);
});

test("Add attorney creates the attorney and returns to /cases/new with it selected", { skip }, async () => {
  await page.goto("/cases/new?client=abc&inquiry=");
  await page.getByRole("link", { name: "Add attorney" }).click();
  await page.waitForURL(/\/attorneys\/new\?returnTo=/);
  await page.locator("#f-attyfirstname").fill("Pat");
  await page.locator("#f-attylastname").fill(ATTY_LAST);
  await pickFirst("#f-attyfirmid");
  await page.getByRole("button", { name: "Save" }).click();
  await page.waitForURL(/\/cases\/new\?attorney=\d+/);
  const [{ attyid }] = ok(await db.from("tblattorney").select("attyid").eq("attylastname", ATTY_LAST));
  assert.equal(await page.locator("#f-caseatty").inputValue(), String(attyid));
});

test("a hostile returnTo is ignored: the attorney create form carries no returnTo", { skip }, async () => {
  await page.goto(`/attorneys/new?returnTo=${encodeURIComponent("//evil.example/cases/new")}`);
  assert.equal(await page.locator('input[name="returnTo"]').count(), 0);
});
