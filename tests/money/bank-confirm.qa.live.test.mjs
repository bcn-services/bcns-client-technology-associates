/**
 * QA live check for /bank-review (BASE_URL, default :3100, hosted DB, staff login): loading the inbox writes nothing to
 * tblexpenses (guardrail), and a retired type with the MOST past uses is neither offered nor preselected — the active
 * type wins. Per-run letters-only names; after() deletes by exactly those.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { chromium } from "@playwright/test";
import { loadEnvLocal } from "../app-shell/seed-e2e.ts";
import { createServerClient } from "../../lib/db/client.ts";

loadEnvLocal();
const BASE = process.env.BASE_URL ?? "http://localhost:3100";
const up = await fetch(`${BASE}/login`).then((r) => r.ok, () => false);
const skip = up && process.env.SUPABASE_SERVICE_ROLE_KEY ? false : "dev server or Supabase unavailable";
const RUN = Array.from({ length: 8 }, () => String.fromCharCode(97 + Math.floor(Math.random() * 26))).join("").toUpperCase();
const ACCT = `QA Heavy ${RUN}`;
const DESC = `Retired Heavy ${RUN} 77`;
const ok = ({ data, error }) => { if (error) throw new Error(error.message); return data; };
const types = {};
let db, browser, page;

before(async () => {
  if (skip) return;
  db = createServerClient();
  for (const [k, name, active] of [["live", `QA Live Type ${RUN}`, true], ["ret", `QA Gone Type ${RUN}`, false]]) {
    types[k] = ok(await db.from("tblexptype").insert({ exptype: name, active }).select("exptypeid").single()).exptypeid;
  }
  const past = (exptype) => ({ expdate: "2025-12-01", expdscr: `RETIRED HEAVY ${RUN}`, expchecknum: 0, exptype, expamount: "10.00", expbranch: "Stratford", expbankaccount: ACCT });
  ok(await db.from("tblexpenses").insert([...Array(5).fill(0).map(() => past(types.ret)), past(types.live)]));
  ok(await db.from("bank_transactions").insert({ bankaccount: ACCT, postedon: "2026-02-03", amount: "-12.00", description: DESC }));
  browser = await chromium.launch();
  page = await (await browser.newContext({ baseURL: BASE })).newPage();
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
  if (!db) return;
  ok(await db.from("bank_transactions").delete().eq("bankaccount", ACCT));
  ok(await db.from("tblexpenses").delete().eq("expbankaccount", ACCT));
  ok(await db.from("tblexptype").delete().in("exptypeid", Object.values(types)));
});

test("retired type with most uses: absent from select, active type preselected; two page loads write no expense", { skip }, async () => {
  for (let i = 0; i < 2; i++) {
    await page.goto("/bank-review");
    await page.getByRole("heading", { name: "Transactions to review" }).waitFor();
  }
  const form = page.getByRole("form", { name: new RegExp(`^Review ${DESC}`) });
  const select = form.getByLabel("Expense type");
  assert.equal(await select.inputValue(), String(types.live));
  const opts = await select.locator("option").allInnerTexts();
  assert.ok(opts.includes(`QA Live Type ${RUN}`) && !opts.includes(`QA Gone Type ${RUN}`), opts.join("|"));
  const exps = ok(await db.from("tblexpenses").select("expid").eq("expbankaccount", ACCT).eq("expdscr", DESC));
  assert.equal(exps.length, 0, "no tblexpenses row without a Confirm click");
  const tx = ok(await db.from("bank_transactions").select("expid").eq("bankaccount", ACCT).single());
  assert.equal(tx.expid, null);
});
