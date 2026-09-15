/**
 * Live check of the /bank-review CSV upload through the real dev server (BASE_URL, default http://localhost:3100), the
 * real importBankAction, and runImportBank against the hosted DB (service-role Db). Signs in as staff (staff may upload).
 * Skips without the server or SUPABASE_SERVICE_ROLE_KEY. Every row goes under a per-run invented bankaccount;
 * after() deletes bank_transactions by exactly those account values.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";
import { loadEnvLocal } from "../app-shell/seed-e2e.ts";
import { createServerClient } from "../../lib/db/client.ts";
import { runImportBank } from "../../lib/bank-import/import.ts";

loadEnvLocal();
const BASE = process.env.BASE_URL ?? "http://localhost:3100";
const FIXTURE = fileURLToPath(new URL("../journeys/fixtures/boa-export.csv", import.meta.url));
const up = await fetch(`${BASE}/login`).then((r) => r.ok, () => false);
const skip = up && process.env.SUPABASE_SERVICE_ROLE_KEY ? false : "dev server or Supabase unavailable";
const RUN = randomUUID().slice(0, 8);
const ACCT = `QA Import ${RUN}`, ACCT2 = `QA Import ${RUN} B`, ACCT3 = `QA Import ${RUN} C`, ACCTS = [ACCT, ACCT2, ACCT3];
let db, browser, page;
const ok = ({ data, error }) => { if (error) throw new Error(error.message); return data; };
const rows = async (acct) => ok(await db.from("bank_transactions").select("*").eq("bankaccount", acct).order("postedon"));
const csv = (body) => ({ name: "export.csv", mimeType: "text/csv", buffer: Buffer.from(`Date,Description,Amount\n${body}`) });

async function uploadInUi(file, account) {
  await page.goto("/bank-review");
  if (account !== undefined) await page.getByLabel("Account", { exact: true }).fill(account);
  await page.getByLabel("Upload CSV").setInputFiles(file);
  await page.getByRole("button", { name: "Import" }).click();
  await page.waitForURL(/[?&](imported|importerror)=/);
  const res = page.getByTestId("import-result"), err = page.getByTestId("import-error");
  await res.or(err).waitFor();
  return (await res.count()) ? await res.innerText() : `ERROR ${await err.innerText()}`;
}

before(async () => {
  if (skip) return;
  db = createServerClient();
  browser = await chromium.launch();
  const ctx = await browser.newContext({ baseURL: BASE });
  page = await ctx.newPage();
  for (let i = 0; ; i++) {
    await page.goto("/login");
    await page.getByLabel(/email/i).fill(process.env.E2E_EMAIL ?? "staff@example.test");
    await page.getByLabel(/password/i).fill(process.env.E2E_PASSWORD ?? "password");
    await page.getByRole("button", { name: /sign in/i }).click();
    try { await page.waitForURL((u) => u.pathname !== "/login", { timeout: 20_000 }); break; } catch (e) { if (i >= 4) throw e; await page.waitForTimeout(3000 * (i + 1)); }
  }
});
after(async () => {
  await browser?.close();
  if (db) ok(await db.from("bank_transactions").delete().in("bankaccount", ACCTS));
});

test("form: account prefilled Bank of America; fixture upload inserts −45.00 and −75.00 under the form's account; re-upload → 2 already imported", { skip }, async () => {
  await page.goto("/bank-review");
  assert.equal(await page.getByLabel("Account", { exact: true }).inputValue(), "Bank of America");
  assert.equal(await uploadInUi(FIXTURE, ACCT), "2 transactions imported, 0 already imported, 0 credits skipped");
  const r = await rows(ACCT);
  assert.deepEqual(r.map((x) => [x.postedon, Number(x.amount).toFixed(2), x.description, x.expid, x.fndsid]), [
    ["2026-01-15", "-45.00", "COURT FILING FEE", null, null],
    ["2026-01-16", "-75.00", "PROCESS SERVER CO", null, null],
  ]);
  assert.equal(await uploadInUi(FIXTURE, ACCT), "0 transactions imported, 2 already imported, 0 credits skipped");
  assert.equal((await rows(ACCT)).length, 2);
  // Inputs reset per render (host-element key): account shows the last-used value, file input is empty.
  assert.equal(await page.getByLabel("Account", { exact: true }).inputValue(), ACCT);
  assert.equal(await page.getByLabel("Upload CSV").inputValue(), "");
});

test("bad date on line 3 → error names line 3, nothing inserted", { skip }, async () => {
  const out = await uploadInUi(csv("2026-01-20,GOOD ROW,-12.00\n2026-02-30,BAD ROW,-13.00\n"), ACCT2);
  assert.match(out, /^ERROR .*Line 3: bad date "2026-02-30"/);
  assert.equal((await rows(ACCT2)).length, 0);
});

test("quoted comma is one description; +100.00 is a skipped credit", { skip }, async () => {
  const out = await uploadInUi(csv('2026-01-22,"SMITH, JONES LLP",-250.00\n2026-01-23,CLIENT DEPOSIT,100.00\n'), ACCT2);
  assert.equal(out, "1 transactions imported, 0 already imported, 1 credits skipped");
  const r = await rows(ACCT2);
  assert.deepEqual(r.map((x) => [x.description, Number(x.amount).toFixed(2)]), [["SMITH, JONES LLP", "-250.00"]]);
});

test("empty account → field error, nothing inserted", { skip }, async () => {
  await page.goto("/bank-review");
  await page.getByLabel("Account", { exact: true }).evaluate((el) => { el.removeAttribute("required"); el.value = "   "; });
  await page.getByLabel("Upload CSV").setInputFiles(FIXTURE);
  await page.getByRole("button", { name: "Import" }).click();
  await page.waitForURL(/importerror=account/);
  assert.match(await page.getByTestId("import-error").innerText(), /Account is required/);
});

test("concurrency: 4 parallel runImportBank of the same file on the hosted DB → 2 rows, imported totals 2, no error", { skip }, async () => {
  const urls = [];
  const deps = { session: async () => ({ userId: "x", email: "x", role: "staff", personId: null }), db: () => db, revalidatePath: () => {}, redirect: (u) => urls.push(u) };
  const fd = () => { const f = new FormData(); f.set("account", ACCT3); f.set("file", new File([`Date,Description,Amount\n2026-02-01,CONC A,-1.10\n2026-02-02,CONC B,-1234567.10\n`], "c.csv")); return f; };
  await Promise.all(Array.from({ length: 4 }, () => runImportBank(fd(), deps)));
  const qs = urls.map((u) => new URL(u, "http://x").searchParams);
  assert.ok(qs.every((p) => !p.get("importerror")), urls.join(" "));
  assert.equal(qs.reduce((n, p) => n + Number(p.get("imported")), 0), 2);
  assert.equal(qs.reduce((n, p) => n + Number(p.get("already")), 0), 6);
  const r = await rows(ACCT3);
  assert.deepEqual(r.map((x) => Number(x.amount).toFixed(2)), ["-1.10", "-1234567.10"]);
});
