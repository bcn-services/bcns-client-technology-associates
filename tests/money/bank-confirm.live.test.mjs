/**
 * Live check of the /bank-review review inbox through the real dev server (BASE_URL, default http://localhost:3100) and
 * the hosted DB. Signs in as staff. Skips without the server or SUPABASE_SERVICE_ROLE_KEY. Per-run invented account,
 * type names and descriptions (letters only — digits are stripped by the suggestion key); after() deletes by exactly those.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { chromium } from "@playwright/test";
import { loadEnvLocal } from "../app-shell/seed-e2e.ts";
import { createServerClient } from "../../lib/db/client.ts";
import { runConfirmTransaction } from "../../lib/bank-import/confirm.ts";

loadEnvLocal();
const BASE = process.env.BASE_URL ?? "http://localhost:3100";
const up = await fetch(`${BASE}/login`).then((r) => r.ok, () => false);
const skip = up && process.env.SUPABASE_SERVICE_ROLE_KEY ? false : "dev server or Supabase unavailable";
const RUN = Array.from({ length: 8 }, () => String.fromCharCode(97 + Math.floor(Math.random() * 26))).join("").toUpperCase();
const ACCT = `QA Review ${RUN}`;
const FEE = `COURT FILING FEE ${RUN}`;
let db, browser, page;
const types = {};
const ok = ({ data, error }) => { if (error) throw new Error(error.message); return data; };
const txOf = async (desc) => ok(await db.from("bank_transactions").select("*").eq("bankaccount", ACCT).eq("description", desc).single());

before(async () => {
  if (skip) return;
  db = createServerClient();
  for (const [k, name, active] of [["fee", `QA Filing Fee ${RUN}`, true], ["mat", `QA Case Material ${RUN}`, true], ["ret", `QA Retired ${RUN}`, false]]) {
    types[k] = ok(await db.from("tblexptype").insert({ exptype: name, active }).select("exptypeid").single()).exptypeid;
  }
  const past = (exptype) => ({ expdate: "2025-12-01", expdscr: FEE, expchecknum: 0, exptype, expamount: "10.00", expbranch: "Stratford", expbankaccount: ACCT });
  ok(await db.from("tblexpenses").insert([past(types.fee), past(types.fee), past(types.fee), past(types.mat)]));
  ok(await db.from("bank_transactions").insert([
    { bankaccount: ACCT, postedon: "2026-01-15", amount: "-45.00", description: `Court Filing Fee ${RUN} 0042` },
    { bankaccount: ACCT, postedon: "2026-01-16", amount: "-75.00", description: `UNMATCHED VENDOR ${RUN}` },
    { bankaccount: ACCT, postedon: "2026-01-17", amount: "-1234567.10", description: `RACE ROW ${RUN}` },
  ]));
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

const rowForm = (desc) => page.getByRole("form", { name: new RegExp(`^Review ${desc}`) });

test("inbox: suggestion prefilled Filing Fee, unmatched has none, no retired type; Confirm → one cleared expense, row leaves inbox, 'Cleared'", { skip }, async () => {
  await page.goto("/bank-review");
  await page.getByRole("heading", { name: "Transactions to review" }).waitFor();
  const fee = rowForm(`Court Filing Fee ${RUN} 0042`), other = rowForm(`UNMATCHED VENDOR ${RUN}`);
  assert.equal(await fee.getByLabel("Expense type").inputValue(), String(types.fee));
  assert.equal(await fee.getByLabel("Description").inputValue(), `Court Filing Fee ${RUN} 0042`);
  assert.equal(await other.getByLabel("Expense type").inputValue(), "");
  const opts = await fee.getByLabel("Expense type").locator("option").allInnerTexts();
  assert.ok(opts.includes(`QA Filing Fee ${RUN}`) && !opts.includes(`QA Retired ${RUN}`), opts.join("|"));
  await fee.getByRole("button", { name: "Confirm" }).click();
  await page.waitForURL(/[?&](cleared|confirmerror)=/);
  assert.match(await page.getByTestId("confirm-result").innerText(), /^Cleared/);
  assert.equal(await rowForm(`Court Filing Fee ${RUN} 0042`).count(), 0, "row left the inbox");
  const t = await txOf(`Court Filing Fee ${RUN} 0042`);
  const exps = ok(await db.from("tblexpenses").select("*").eq("expbankaccount", ACCT).eq("expdscr", `Court Filing Fee ${RUN} 0042`));
  assert.equal(exps.length, 1);
  const e = exps[0];
  assert.equal(t.expid, e.expid);
  assert.deepEqual([e.expclearedbank, e.expdatecleared, e.expdate, Number(e.expamount).toFixed(2), e.expchecknum, e.expbranch, e.exptype],
    [true, "2026-01-15", "2026-01-15", "45.00", 0, "Stratford", types.fee]);
});

test("race: two parallel confirms of one transaction on the hosted DB → exactly one tblexpenses row; one wins, one 'done'", { skip }, async () => {
  const t = await txOf(`RACE ROW ${RUN}`);
  const urls = [];
  const deps = { session: async () => ({ userId: "x", email: "x", role: "staff", personId: null }), db: () => db, revalidatePath: () => {}, redirect: (u) => urls.push(u) };
  const fd = () => { const f = new FormData(); f.set("tx", String(t.id)); f.set("type", String(types.mat)); f.set("case", ""); f.set("dscr", `RACE ROW ${RUN}`); return f; };
  await Promise.all([runConfirmTransaction(fd(), deps), runConfirmTransaction(fd(), deps)]);
  const exps = ok(await db.from("tblexpenses").select("expid, expamount").eq("expbankaccount", ACCT).eq("expdscr", `RACE ROW ${RUN}`));
  assert.equal(exps.length, 1, urls.join(" "));
  assert.equal(Number(exps[0].expamount).toFixed(2), "1234567.10");
  assert.equal((await txOf(`RACE ROW ${RUN}`)).expid, exps[0].expid);
  const qs = urls.map((u) => Object.fromEntries(new URL(u, "http://x").searchParams));
  assert.equal(qs.filter((p) => p.cleared).length, 1, urls.join(" "));
  assert.equal(qs.filter((p) => p.confirmerror === "done").length, 1, urls.join(" "));
});
