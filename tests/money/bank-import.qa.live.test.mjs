/**
 * QA live gaps for /bank-review upload (real dev server, Playwright, hosted DB): admin upload, unauthenticated refused,
 * oversize file, account kept + file cleared after an error. Skips without the server or SUPABASE_SERVICE_ROLE_KEY.
 * Rows go under a per-run invented account; after() deletes by exactly those values.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { chromium } from "@playwright/test";
import { loadEnvLocal } from "../app-shell/seed-e2e.ts";
import { createServerClient } from "../../lib/db/client.ts";

loadEnvLocal();
const BASE = process.env.BASE_URL ?? "http://localhost:3100";
const up = await fetch(`${BASE}/login`).then((r) => r.ok, () => false);
const skip = up && process.env.SUPABASE_SERVICE_ROLE_KEY ? false : "dev server or Supabase unavailable";
const ACCT = `QA Live ${randomUUID().slice(0, 8)}`;
let db, browser;
const ok = ({ data, error }) => { if (error) throw new Error(error.message); return data; };
const rows = async () => ok(await db.from("bank_transactions").select("*").eq("bankaccount", ACCT).order("postedon"));
const csv = (body) => ({ name: "e.csv", mimeType: "text/csv", buffer: Buffer.from(`Date,Description,Amount\n${body}`) });

async function login(email, password) {
  const page = await (await browser.newContext({ baseURL: BASE })).newPage();
  for (let i = 0; ; i++) {
    await page.goto("/login");
    await page.getByLabel(/email/i).fill(email);
    await page.getByLabel(/password/i).fill(password);
    await page.getByRole("button", { name: /sign in/i }).click();
    try { await page.waitForURL((u) => u.pathname !== "/login", { timeout: 20_000 }); return page; } catch (e) { if (i >= 4) throw e; await page.waitForTimeout(3000 * (i + 1)); }
  }
}
async function upload(page, file, account) {
  await page.goto("/bank-review");
  await page.getByLabel("Account", { exact: true }).fill(account);
  await page.getByLabel("Upload CSV").setInputFiles(file);
  await page.getByRole("button", { name: "Import" }).click();
  await page.waitForURL(/[?&](imported|importerror)=/);
  const res = page.getByTestId("import-result"), err = page.getByTestId("import-error");
  await res.or(err).waitFor();
  return (await res.count()) ? await res.innerText() : `ERROR ${await err.innerText()}`;
}

before(async () => { if (skip) return; db = createServerClient(); browser = await chromium.launch(); });
after(async () => {
  await browser?.close();
  if (db) ok(await db.from("bank_transactions").delete().eq("bankaccount", ACCT));
});

test("unauthenticated visitor to /bank-review is sent to /login", { skip }, async () => {
  const page = await (await browser.newContext({ baseURL: BASE })).newPage();
  await page.goto("/bank-review");
  assert.equal(new URL(page.url()).pathname, "/login");
});

test("admin can upload; error keeps the account and clears the file; oversize refused", { skip }, async () => {
  const page = await login(process.env.E2E_ADMIN_EMAIL ?? "admin@example.test", process.env.E2E_ADMIN_PASSWORD ?? "password");
  assert.equal(await upload(page, csv("2026-03-01,QA ADMIN ROW,-9.99\n"), ACCT), "1 transactions imported, 0 already imported, 0 credits skipped");
  assert.deepEqual((await rows()).map((r) => [r.description, Number(r.amount).toFixed(2), r.bankaccount]), [["QA ADMIN ROW", "-9.99", ACCT]]);

  const out = await upload(page, csv("2026-03-02,GOOD,-1.00\n2026-02-30,BAD,-2.00\n2026-03-03,GOOD2,-3.00\n"), ACCT);
  assert.match(out, /^ERROR .*Line 3: bad date "2026-02-30"$/);
  assert.equal(await page.getByLabel("Account", { exact: true }).inputValue(), ACCT);
  assert.equal(await page.getByLabel("Upload CSV").inputValue(), "");
  assert.equal((await rows()).length, 1, "nothing from the bad file");

  const big = csv("2026-03-04,X,-1.00\n".repeat(60_000));
  const bigOut = await upload(page, big, ACCT).catch((e) => `THREW ${e.message}`);
  assert.match(bigOut, /^ERROR File is larger than 1 MB/, bigOut);
  assert.equal((await rows()).length, 1);
});
