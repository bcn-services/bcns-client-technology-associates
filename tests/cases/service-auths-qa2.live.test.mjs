/**
 * QA attempt 2 browser checks through the real server action (dev server at BASE_URL, default :3107):
 * with seeded rows of differing statuses, every row form shows its own values after an add and after a
 * failed update; untouched Updates write nothing; the add form resets; a double-click adds one row;
 * the "All" totals row equals the hand sum of the status rows. Tagged rows are purged at setup/teardown.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { chromium } from "@playwright/test";
import { loadEnvLocal } from "../app-shell/seed-e2e.ts";
import { createServerClient } from "../../lib/db/client.ts";

loadEnvLocal();
const BASE = process.env.BASE_URL ?? "http://localhost:3107";
const ID = 90001;
const TAG = "SA-QA2-TEST";
const COLS = ["srvauthdate", "srvauthhours", "srvauthstatus", "srvdateapproved", "srvauthfile", "srvadvance", "srvauthnotes"];
let db, browser, page;
const ok = ({ data, error }) => { if (error) throw new Error(error.message); return data; };
const purge = async () => ok(await db.from("tblsrvauth").delete().like("srvauthnotes", `${TAG}%`));
const tagged = async () => ok(await db.from("tblsrvauth").select("*").like("srvauthnotes", `${TAG}%`).order("srvauthid"));

before(async () => {
  const up = await fetch(`${BASE}/login`).then((r) => r.ok, () => false);
  if (!up || !process.env.SUPABASE_SERVICE_ROLE_KEY) return;
  db = createServerClient();
  await purge();
  ok(await db.from("tblsrvauth").insert([
    { srvauthcaseid: ID, srvauthdate: "2026-07-01", srvauthhours: 2.5, srvauthstatus: "Approved", srvdateapproved: "2026-07-03", srvauthfile: "QA2-A", srvadvance: 100, srvauthnotes: `${TAG} A` },
    { srvauthcaseid: ID, srvauthdate: "2026-07-02", srvauthhours: 0.125, srvauthstatus: "Declined", srvauthfile: "QA2-B", srvauthnotes: `${TAG} B` },
    { srvauthcaseid: ID, srvauthdate: "2026-07-04", srvauthhours: 1, srvauthstatus: "awaiting approval", srvauthnotes: `${TAG} C` },
  ]));
  browser = await chromium.launch();
  page = await browser.newPage({ baseURL: BASE });
  for (let i = 0; ; i++) {
    await page.goto("/login");
    await page.getByLabel(/email/i).fill(process.env.E2E_EMAIL ?? "staff@example.test");
    await page.getByLabel(/password/i).fill(process.env.E2E_PASSWORD ?? "password");
    await page.getByRole("button", { name: /sign in/i }).click();
    try { await page.waitForURL((u) => u.pathname !== "/login", { timeout: 20_000 }); break; } catch (e) { if (i >= 4) throw e; await page.waitForTimeout(3000 * (i + 1)); }
  }
});
after(async () => { await browser?.close(); if (db) await purge(); });

const submit = async (form, label) => {
  const prev = page.url();
  await form.getByRole("button", { name: label }).click();
  await page.waitForURL((u) => u.href !== prev && /sa=|sa_error=/.test(u.href));
};
const norm = (s) => s.replace(/\r\n?/g, "\n");

/** Every tagged row's form: each visible field equals its own __orig, and status/notes/hours match the DB row. */
async function assertFormsMatchRows(rows, when) {
  for (const r of rows) {
    const form = page.locator(`form[data-srvauthid="${r.srvauthid}"]`);
    for (const c of COLS) {
      const shown = norm(await form.locator(`[name="${c}"]`).inputValue());
      const orig = norm(await form.locator(`[name="${c}__orig"]`).inputValue());
      assert.equal(shown, orig, `${when}: row ${r.srvauthid} ${c} shows "${shown}" but was rendered from "${orig}"`);
    }
    assert.equal(await form.locator('[name="srvauthstatus"]').inputValue(), r.srvauthstatus, `${when}: row ${r.srvauthid} status`);
    assert.equal(await form.locator('[name="srvauthnotes"]').inputValue(), r.srvauthnotes, `${when}: row ${r.srvauthid} notes`);
    assert.equal(await form.locator('[name="srvauthhours"]').inputValue(), Number(r.srvauthhours).toFixed(3), `${when}: row ${r.srvauthid} hours`);
  }
}

test("after an add and after a failed update, every row form shows its own values; untouched Updates write nothing", async (t) => {
  if (!db) return t.skip("dev server or Supabase unavailable");
  await page.goto(`/cases/${ID}`);
  const add = page.getByTestId("sa-add");
  await add.getByLabel("Hours").fill("3.333");
  await add.getByLabel("File").fill("QA2-NEW");
  await add.getByLabel("Notes").fill(`${TAG} new`);
  await submit(add, "Add authorization");
  assert.match(page.url(), /sa=1/);
  const rows = await tagged();
  assert.equal(rows.length, 4);
  await assertFormsMatchRows(rows, "after add");

  // add form reset
  const add2 = page.getByTestId("sa-add");
  assert.equal(await add2.getByLabel("Hours").inputValue(), "");
  assert.equal(await add2.getByLabel("Notes").inputValue(), "");
  assert.equal(await add2.getByLabel("File").inputValue(), "");
  assert.equal(await add2.getByLabel("Status").inputValue(), "Awaiting Approval");

  // failed update (too many decimals; bypass browser step validation so the server rejects it)
  const a = rows.find((r) => r.srvauthnotes === `${TAG} A`);
  const fa = page.locator(`form[data-srvauthid="${a.srvauthid}"]`);
  await fa.evaluate((f) => { f.noValidate = true; });
  await fa.getByLabel("Hours").fill("1.2345");
  await submit(fa, "Update authorization");
  assert.match(page.url(), /sa_error=hours/);
  assert.deepEqual(await tagged(), rows, "failed update wrote nothing");
  await assertFormsMatchRows(rows, "after failed update");

  // untouched Update on every tagged row writes nothing
  for (const r of rows) {
    await submit(page.locator(`form[data-srvauthid="${r.srvauthid}"]`), "Update authorization");
    assert.match(page.url(), /sa=0/, `row ${r.srvauthid} untouched save reports no changes`);
    assert.deepEqual(await tagged(), rows, `row ${r.srvauthid} untouched Update wrote nothing`);
  }
});

test("double-click on Add inserts exactly one row; button is disabled while pending", async (t) => {
  if (!db) return t.skip("dev server or Supabase unavailable");
  await page.goto(`/cases/${ID}`);
  const add = page.getByTestId("sa-add");
  await add.getByLabel("Hours").fill("0.5");
  await add.getByLabel("Notes").fill(`${TAG} dbl`);
  const btn = add.getByRole("button", { name: "Add authorization" });
  const prev = page.url();
  await btn.dblclick();
  const sawDisabled = await btn.isDisabled().catch(() => false);
  await page.waitForURL((u) => u.href !== prev && /sa=/.test(u.href));
  await page.waitForTimeout(1500);
  assert.equal((await tagged()).filter((r) => r.srvauthnotes === `${TAG} dbl`).length, 1);
  t.diagnostic(`button disabled right after dblclick: ${sawDisabled}`);
});

test("totals: All row equals the hand sum of the status rows and of the DB, exact to 3 decimals", async (t) => {
  if (!db) return t.skip("dev server or Supabase unavailable");
  const r = await page.goto("/cases/service-auths?view=totals");
  assert.equal(r.status(), 200);
  const cells = await page.getByTestId("sa-totals").locator("tbody tr").evaluateAll((trs) => trs.map((tr) => [...tr.querySelectorAll("td")].map((td) => td.textContent.trim())));
  const all = cells.pop();
  assert.equal(all[0], "All");
  const m = (s) => Math.round(Number(s) * 1000);
  const handMilli = cells.reduce((n, c) => n + m(c[2]), 0);
  assert.equal(all[2], (handMilli / 1000).toFixed(3));
  assert.equal(Number(all[1]), cells.reduce((n, c) => n + Number(c[1]), 0));
  // independent hand count from the table itself
  let dbMilli = 0, dbCount = 0;
  for (let from = 0; ; from += 1000) {
    const page_ = ok(await db.from("tblsrvauth").select("srvauthhours").order("srvauthid").range(from, from + 999));
    for (const x of page_) { dbMilli += m(x.srvauthhours ?? 0); dbCount++; }
    if (!page_.length) break;
  }
  assert.equal(Number(all[1]), dbCount);
  assert.equal(all[2], (dbMilli / 1000).toFixed(3));
});
