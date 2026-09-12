/**
 * QA browser checks through the real server action (dev server at BASE_URL, default :3107):
 * hours 1.235 round-trip, untouched Update writes nothing, lists show the row. Tagged rows are
 * removed with the service role at setup and teardown. Skips when server or Supabase is unavailable.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { chromium } from "@playwright/test";
import { loadEnvLocal } from "../app-shell/seed-e2e.ts";
import { createServerClient } from "../../lib/db/client.ts";

loadEnvLocal();
const BASE = process.env.BASE_URL ?? "http://localhost:3107";
const ID = 90001;
const TAG = "SA-QA-TEST";
let up = false;
let db, browser, page;
const ok = ({ data, error }) => { if (error) throw new Error(error.message); return data; };
const purge = async () => ok(await db.from("tblsrvauth").delete().like("srvauthnotes", `${TAG}%`));
const tagged = async () => ok(await db.from("tblsrvauth").select("*").like("srvauthnotes", `${TAG}%`).order("srvauthid"));

before(async () => {
  up = await fetch(`${BASE}/login`).then((r) => r.ok, () => false);
  if (!up || !process.env.SUPABASE_SERVICE_ROLE_KEY) return;
  db = createServerClient();
  await purge();
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

test("1.235 hours round-trips through the browser; untouched Update writes nothing; row in Unapproved", async (t) => {
  if (!db) return t.skip("dev server or Supabase unavailable");
  await page.goto(`/cases/${ID}`);
  const add = page.getByTestId("sa-add");
  await add.getByLabel("Hours").fill("1.235");
  await add.getByLabel("Notes").fill(`${TAG} rt`);
  await submit(add, "Add authorization");
  const [row] = await tagged();
  assert.equal(String(row.srvauthhours), "1.235");

  const edit = page.locator(`[data-srvauthid="${row.srvauthid}"]`);
  assert.equal(await edit.getByLabel("Hours").inputValue(), "1.235");
  await submit(edit, "Update authorization");
  const [again] = await tagged();
  assert.deepEqual(again, row, "row unchanged");
  assert.match(page.url(), /sa=0/, "untouched save reports no changes");
  assert.equal(await page.locator("#service-auths").getByRole("button", { name: /delete|remove/i }).count(), 0);

  const r = await page.goto("/cases/service-auths");
  assert.equal(r.status(), 200);
  const text = await page.getByTestId("sa-unapproved").innerText();
  assert.match(text, /90001/); assert.match(text, /1\.235/);
});
