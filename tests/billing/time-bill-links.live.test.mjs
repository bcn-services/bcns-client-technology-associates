/**
 * Live check of billing item 9 through the real dev server (BASE_URL, default http://localhost:3100): the real
 * /cases/<id> Time panel and the real /time week view show "Bill #N" → /bills/N on a tblactivity row with actbillid = N,
 * the billed marker with no link on a legacy billed row, and neither on an unbilled row. Skips without the server or
 * SUPABASE_SERVICE_ROLE_KEY. Own rows on invented case 991401 (copy of case 90001's tblcase row; 90001 is only read);
 * 991400–991499 is cleared at setup, and every inserted row is deleted by exact id in after(). The E2E staff login is
 * linked to personid 1 for the run and its prior personid restored after.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { chromium } from "@playwright/test";
import { loadEnvLocal } from "../app-shell/seed-e2e.ts";
import { createServerClient } from "../../lib/db/client.ts";

loadEnvLocal();
const BASE = process.env.BASE_URL ?? "http://localhost:3100";
const EMAIL = process.env.E2E_EMAIL ?? "staff@example.test";
const up = await fetch(`${BASE}/login`).then((r) => r.ok, () => false);
const skip = up && process.env.SUPABASE_SERVICE_ROLE_KEY ? false : "dev server or Supabase unavailable";
const CASE = 991401;
const TODAY = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date()); // firm-local, in this week
const TAG = `TBL ${randomUUID().slice(0, 8)}`;
const DESC = { linked: `${TAG} linked`, legacy: `${TAG} legacy`, unbilled: `${TAG} unbilled` };
let db, browser, page, priorPersonId, billId, actIds = [];
const ok = ({ data, error }) => { if (error) throw new Error(error.message); return data; };
const setPerson = async (v) => ok(await db.from("profiles").update({ personid: v }).eq("email", EMAIL));
const clearRange = async () => {
  ok(await db.from("tblactivity").delete().gte("actcaseid", 991400).lte("actcaseid", 991499));
  ok(await db.from("tblbills").delete().gte("billcaseid", 991400).lte("billcaseid", 991499));
  ok(await db.from("tblcase").delete().gte("caseid", 991400).lte("caseid", 991499));
};
const norm = (s) => s.replace(/\s+/g, " ").trim();
const billLinks = (loc) => loc.locator('a[href^="/bills/"]').evaluateAll((as) => as.map((a) => ({ href: a.getAttribute("href"), text: a.textContent })));

before(async () => {
  if (skip) return;
  db = createServerClient();
  await clearRange();
  const src = ok(await db.from("tblcase").select("*").eq("caseid", 90001).single());
  ok(await db.from("tblcase").insert({ ...src, caseid: CASE }));
  billId = ok(await db.from("tblbills").insert({ billcaseid: CASE, billdate: TODAY, billtype: "timesheet", billhours: 0.5, billbalance: 10, billnotice: "1st" }).select("billid").single()).billid;
  const act = (d, actbilled, actbillid) => ({ actcaseid: CASE, actdate: TODAY, actdescription: d, acthrs: "0.500", actwho: 1, actbilled, actbillid });
  actIds = ok(await db.from("tblactivity").insert([act(DESC.linked, true, billId), act(DESC.legacy, true, null), act(DESC.unbilled, false, null)]).select("actid")).map((r) => r.actid);
  priorPersonId = ok(await db.from("profiles").select("personid").eq("email", EMAIL).single()).personid;
  await setPerson(1);
  browser = await chromium.launch();
  page = await browser.newPage({ baseURL: BASE });
  await fetch(`${BASE}/api/health`).catch(() => {});
  for (let i = 0; ; i++) { // shared project → auth 429s; back off
    await page.goto("/login", { timeout: 120_000 });
    await page.getByLabel(/email/i).fill(EMAIL);
    await page.getByLabel(/password/i).fill(process.env.E2E_PASSWORD ?? "password");
    await page.getByRole("button", { name: /sign in/i }).click();
    try { await page.waitForURL((u) => u.pathname !== "/login", { timeout: 20_000 }); break; } catch (e) { if (i >= 4) throw e; await page.waitForTimeout(3000 * (i + 1)); }
  }
  for (const p of [`/cases/${CASE}`, "/time"]) await page.goto(p, { timeout: 120_000 }); // warm first compiles
});
after(async () => {
  await browser?.close();
  if (!db) return;
  if (actIds.length) ok(await db.from("tblactivity").delete().in("actid", actIds));
  if (billId) ok(await db.from("tblbills").delete().eq("billid", billId));
  ok(await db.from("tblcase").delete().eq("caseid", CASE));
  await setPerson(priorPersonId ?? null);
});

test("/cases/991401 Time panel: actbillid row → marker + 'Bill #N' → /bills/N; legacy → marker, no link; unbilled → neither", { skip }, async () => {
  await page.goto(`/cases/${CASE}`);
  const panel = page.getByTestId("time-panel");
  await panel.getByRole("heading", { name: "Time" }).waitFor({ timeout: 30_000 });
  const row = (d) => panel.getByTestId("time-row").filter({ hasText: d });
  for (const d of Object.values(DESC)) assert.equal(await row(d).count(), 1, `one row for ${d}`);
  assert.equal(await row(DESC.linked).getByTestId("billed-marker").count(), 1);
  assert.deepEqual(await billLinks(row(DESC.linked)), [{ href: `/bills/${billId}`, text: `Bill #${billId}` }]);
  assert.equal(await row(DESC.legacy).getByTestId("billed-marker").count(), 1);
  assert.deepEqual(await billLinks(row(DESC.legacy)), []);
  assert.doesNotMatch(norm(await row(DESC.legacy).innerText()), /Bill #/);
  assert.equal(await row(DESC.unbilled).getByTestId("billed-marker").count(), 0);
  assert.deepEqual(await billLinks(row(DESC.unbilled)), []);
  assert.doesNotMatch(await panel.innerText(), /bills/i, "panel adds no /bills/i text (journey 01)");
  assert.equal(await panel.getByRole("button").count(), 0);
});

test("/time week view (staff, personid 1): actbillid row → 'billed' + 'Bill #N' → /bills/N; legacy → 'billed', no link; unbilled → neither", { skip }, async () => {
  await page.goto("/time");
  await page.getByTestId("week-table").waitFor({ timeout: 30_000 });
  const row = (d) => page.getByTestId("week-table").locator("tr").filter({ hasText: d });
  const marker = (d) => row(d).locator("span").filter({ hasText: /^billed$/ }).count();
  for (const d of Object.values(DESC)) assert.equal(await row(d).count(), 1, `one row for ${d}`);
  assert.equal(await marker(DESC.linked), 1);
  assert.deepEqual(await billLinks(row(DESC.linked)), [{ href: `/bills/${billId}`, text: `Bill #${billId}` }]);
  assert.equal(await marker(DESC.legacy), 1);
  assert.deepEqual(await billLinks(row(DESC.legacy)), []);
  assert.equal(await marker(DESC.unbilled), 0);
  assert.deepEqual(await billLinks(row(DESC.unbilled)), []);
});
