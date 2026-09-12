/**
 * Live checks for lib/inquiries against the hosted Supabase in .env.local (invented rows, removed in after()).
 * The HTTP part also needs a dev server on BASE_URL (default http://localhost:3102); it skips, and says so, without one.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { loadEnvLocal, seedE2eUser } from "../app-shell/seed-e2e.ts";
import { createServerClient } from "../../lib/db/client.ts";
import { QUICK_SEARCH_FIELDS, SENT_BOOLS, quickSearch, advancedSearch } from "../../lib/inquiries/inquiries.ts";

loadEnvLocal();
const BASE = process.env.BASE_URL ?? "http://localhost:3102";
const EMAIL = process.env.E2E_EMAIL ?? "staff@example.test";
const PASSWORD = process.env.E2E_PASSWORD ?? "password";
const M = `zqinq${Date.now().toString(36)}`; // unique marker on every seeded row
const db = createServerClient();
const ids = [];

async function insert(rows) {
  const { data, error } = await db.from("tblinquiry").insert(rows).select("id");
  if (error) throw new Error(error.message);
  ids.push(...data.map((r) => r.id));
  return data.map((r) => r.id);
}

let fieldRow;
const dated = {};
const lit = {};
before(async () => {
  [fieldRow] = await insert([{ inqdate: "2031-01-01", ...Object.fromEntries(QUICK_SEARCH_FIELDS.map((f) => [f, `pre ${M}-${f}-mixedCase post`])) }]);
  for (const d of ["2031-05-09", "2031-05-10", "2031-05-15", "2031-05-20", "2031-05-21"]) [dated[d]] = await insert([{ inqdate: d, inqsubject: `${M}date` }]);
  const subjects = { pct: `${M}lit 50%off`, pctX: `${M}lit 50Xoff`, und: `${M}lit a_b`, undX: `${M}lit aXb`, punct: `${M}lit x,(y)"z` };
  for (const [k, s] of Object.entries(subjects)) [lit[k]] = await insert([{ inqdate: "2031-02-02", inqsubject: s }]);
});

after(async () => {
  const { data } = await db.from("tblinquiry").select("id").ilike("inqcallername", `%${M}%`);
  const all = [...ids, ...(data ?? []).map((r) => r.id)];
  if (all.length) await db.from("tblinquiry").delete().in("id", all);
});

for (const f of QUICK_SEARCH_FIELDS) {
  test(`quick search finds the row by an upper-case substring of ${f}`, async () => {
    const rows = await quickSearch(db, `${M}-${f}-MIXEDcase`.toUpperCase());
    assert.deepEqual(rows.map((r) => r.id), [fieldRow], `${f} not searched`);
  });
}

const dateIds = (rows) => rows.map((r) => r.id).sort((a, b) => a - b);
const exp = (...ds) => ds.map((d) => dated[d]).sort((a, b) => a - b);
test("advanced date mode between is inclusive of both boundaries", async () => {
  assert.deepEqual(dateIds(await advancedSearch(db, { subject: `${M}date`, dateMode: "between", date1: "2031-05-10", date2: "2031-05-20" })), exp("2031-05-10", "2031-05-15", "2031-05-20"));
});
test("advanced date mode on-or-after is inclusive", async () => {
  assert.deepEqual(dateIds(await advancedSearch(db, { subject: `${M}date`, dateMode: "onOrAfter", date1: "2031-05-15" })), exp("2031-05-15", "2031-05-20", "2031-05-21"));
});
test("advanced date mode on-or-before is inclusive", async () => {
  assert.deepEqual(dateIds(await advancedSearch(db, { subject: `${M}date`, dateMode: "onOrBefore", date1: "2031-05-15" })), exp("2031-05-09", "2031-05-10", "2031-05-15"));
});

test("% and _ match literally in quick and advanced search; commas/parens/quotes don't break the or() filter", async () => {
  for (const search of [quickSearch, (d, q) => advancedSearch(d, { subject: q })]) {
    assert.deepEqual((await search(db, `${M}lit 50%off`)).map((r) => r.id), [lit.pct]);
    assert.deepEqual((await search(db, `${M}lit a_b`)).map((r) => r.id), [lit.und]);
    assert.deepEqual((await search(db, `${M}LIT X,(Y)"Z`)).map((r) => r.id), [lit.punct]);
  }
});

// --- HTTP: create → redirect → message; edit toggles every sent field on then off -------------------------
let up = false;
try {
  await fetch(`${BASE}/login`, { signal: AbortSignal.timeout(5000) });
  up = true;
} catch {}
const skip = up ? false : `no app at ${BASE}`;
console.log(up ? `[inquiries.live] HTTP checks RUN against ${BASE}` : `[inquiries.live] HTTP checks SKIPPED: no app at ${BASE}`);

async function retry(fn, tries = 6) {
  for (let i = 0; ; i++) {
    try {
      return await fn();
    } catch (e) {
      if (i >= tries - 1 || !/429|rate|too many/i.test(String(e?.message))) throw e;
      await new Promise((r) => setTimeout(r, 2000 * 2 ** i));
    }
  }
}

test("HTTP: create lands on /inquiries/<id> with 'Inquiry created'; every sent field persists on then off", { skip, timeout: 240_000 }, async () => {
  const { chromium } = await import("@playwright/test");
  await retry(() => seedE2eUser(db, EMAIL, PASSWORD));
  const browser = await chromium.launch();
  try {
    const page = await (await browser.newContext()).newPage();
    await retry(async () => {
      await page.goto(`${BASE}/login`);
      await page.getByLabel(/email/i).fill(EMAIL);
      await page.getByLabel(/password/i).fill(PASSWORD);
      await page.getByRole("button", { name: /sign in/i }).click();
      await page.waitForURL((u) => u.pathname !== "/login", { timeout: 20_000 }).catch(async () => {
        throw new Error(`login stuck (429?): ${await page.locator("body").innerText()}`);
      });
    });

    // Exactly the selectors journey 02 uses (strict mode throws on 0 or >1 matches).
    await page.goto(`${BASE}/inquiries/new`);
    await page.getByLabel(/subject/i).fill(`Slip and fall ${M}`);
    await page.getByLabel(/caller name/i).fill(`Jane ${M}`);
    await page.getByRole("button", { name: /save|create/i }).click();
    await page.waitForURL(/\/inquiries\/\d+\?created=1$/, { timeout: 60_000 });
    const id = Number(page.url().match(/\/inquiries\/(\d+)/)[1]);
    ids.push(id);
    assert.ok(await page.getByText(/inquiry created/i).isVisible(), "no 'Inquiry created'");
    assert.equal(await page.getByLabel(/subject/i).inputValue(), `Slip and fall ${M}`);
    assert.equal(await page.getByLabel(/caller name/i).inputValue(), `Jane ${M}`);
    const { data: created } = await db.from("tblinquiry").select("*").eq("id", id).single();
    assert.equal(created.inqhowheardaboutus, "Unknown");
    assert.equal(created.inqengineer, "Dr. Ojalvo");

    const branch = await page.locator('select[name="sentbranch"] option:not([value=""])').first().getAttribute("value").catch(() => null);
    const names = { sentother1name: `o1 ${M}`, sentother2name: `o2 ${M}`, sentinfo1: "i1", sentinfo2: "i2", sentinfo3: "i3" };
    const save = async () => {
      await page.getByRole("button", { name: /save/i }).click();
      await page.waitForURL(/\?saved=1$/, { timeout: 60_000 });
      assert.ok(await page.getByText(/inquiry saved/i).isVisible(), "no 'Inquiry saved'");
      const { data } = await db.from("tblinquiry").select("*").eq("id", id).single();
      return data;
    };

    await page.goto(`${BASE}/inquiries/${id}`);
    for (const k of SENT_BOOLS) await page.locator(`input[name="${k}"]`).check();
    for (const [k, v] of Object.entries(names)) await page.locator(`input[name="${k}"]`).fill(v);
    if (branch) await page.locator('select[name="sentbranch"]').selectOption(branch);
    const on = await save();
    for (const k of SENT_BOOLS) assert.equal(on[k], true, `${k} on`);
    for (const [k, v] of Object.entries(names)) assert.equal(on[k], v, `${k} set`);
    if (branch) assert.equal(on.sentbranch, branch);
    else console.log("[inquiries.live] tblbranches empty: sentbranch HTTP toggle not exercised");
    assert.equal(on.inqsubject, `Slip and fall ${M}`, "unrelated column changed");

    await page.goto(`${BASE}/inquiries/${id}`);
    for (const k of SENT_BOOLS) await page.locator(`input[name="${k}"]`).uncheck();
    for (const k of Object.keys(names)) await page.locator(`input[name="${k}"]`).fill("");
    if (branch) await page.locator('select[name="sentbranch"]').selectOption("");
    const off = await save();
    for (const k of SENT_BOOLS) assert.equal(off[k], false, `${k} off`);
    for (const k of Object.keys(names)) assert.equal(off[k], null, `${k} cleared`);
    if (branch) assert.equal(off.sentbranch, null);
  } finally {
    await browser.close();
  }
});
