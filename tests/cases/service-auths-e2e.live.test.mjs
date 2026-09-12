/**
 * Browser smoke for the service-auth panel and lists through the real server action (dev server at
 * BASE_URL, default http://localhost:3107). Rows added carry the notes tag and are removed with the
 * service role at setup and teardown. Skips when BASE_URL is unreachable or Supabase is unconfigured.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { chromium } from "@playwright/test";
import { loadEnvLocal } from "../app-shell/seed-e2e.ts";
import { createServerClient } from "../../lib/db/client.ts";
import { firmToday } from "../../lib/cases/presets.ts";

loadEnvLocal();
const BASE = process.env.BASE_URL ?? "http://localhost:3107";
const ID = 90001;
const TAG = "SA-E2E-TEST";
const up = await fetch(`${BASE}/login`).then((r) => r.ok, () => false);
const skip = up && process.env.SUPABASE_SERVICE_ROLE_KEY ? false : "dev server or Supabase unavailable";
let db, browser, page;
const ok = ({ data, error }) => { if (error) throw new Error(error.message); return data; };
const purge = async () => ok(await db.from("tblsrvauth").delete().like("srvauthnotes", `${TAG}%`));
const tagged = async () => ok(await db.from("tblsrvauth").select("*").like("srvauthnotes", `${TAG}%`).order("srvauthid"));

before(async () => {
  if (skip) return;
  db = createServerClient();
  await purge();
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
after(async () => { await browser?.close(); if (db) await purge(); });

const submit = async (form, label) => {
  const prev = page.url();
  await form.getByRole("button", { name: label }).click();
  await page.waitForURL((u) => u.href !== prev && /sa=|sa_error=/.test(u.href));
};

test("add an auth, then move it to Approved: stamped with today; no delete control", { skip }, async () => {
  await page.goto(`/cases/${ID}`);
  const add = page.getByTestId("sa-add");
  await add.getByLabel("Hours").fill("2.125");
  await add.getByLabel("Notes").fill(`${TAG} e2e`);
  await submit(add, "Add authorization");
  assert.match(page.url(), /sa=1/);
  const [row] = await tagged();
  assert.equal(Number(row.srvauthhours), 2.125);
  assert.equal(row.srvauthstatus, "Awaiting Approval");
  assert.equal(row.srvdateapproved, null);

  const edit = page.locator(`[data-srvauthid="${row.srvauthid}"]`);
  await edit.getByLabel("Status").selectOption("Approved");
  await submit(edit, "Update authorization");
  const [after] = await tagged();
  assert.equal(after.srvdateapproved, firmToday(new Date()));
  assert.equal(await page.locator("#service-auths").getByRole("button", { name: /delete/i }).count(), 0);
});

test("bad hours show a message, not a 500", { skip }, async () => {
  await page.goto(`/cases/${ID}`);
  const add = page.getByTestId("sa-add");
  await add.getByLabel("Hours").evaluate((el) => { el.type = "text"; el.value = "1.2345"; }); // bypass the browser's step check
  await submit(add, "Add authorization");
  assert.match(await page.getByRole("alert").filter({ hasText: /3 decimals/ }).innerText(), /3 decimals/);
});

test("lists render: Unapproved (default), Recently approved, Totals", { skip }, async () => {
  for (const [q, id] of [["", "sa-unapproved"], ["?view=approved", "sa-approved"], ["?view=totals", "sa-totals"]]) {
    const r = await page.goto(`/cases/service-auths${q}`);
    assert.equal(r.status(), 200, q);
    assert.ok(await page.getByTestId(id).count() || await page.getByText("No service authorizations.").count(), id);
  }
});
