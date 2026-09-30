/**
 * Live check of /expenses (dev server at BASE_URL, default http://localhost:3100). Skips when unreachable or Supabase
 * is unconfigured. Creates invented case 990901 (copy of 90001) with 3 expenses, and seeds 5,000 firm-wide 2026-01
 * expenses whose descriptions start with a per-run marker; after() deletes every row carrying that marker and the case.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { chromium } from "@playwright/test";
import { loadEnvLocal } from "../app-shell/seed-e2e.ts";
import { createServerClient } from "../../lib/db/client.ts";

loadEnvLocal();
const BASE = process.env.BASE_URL ?? "http://localhost:3100";
const EMAIL = process.env.E2E_EMAIL ?? "staff@example.test";
const up = await fetch(`${BASE}/login`).then((r) => r.ok, () => false);
const skip = up && process.env.SUPABASE_SERVICE_ROLE_KEY ? false : "dev server or Supabase unavailable";
const CASE = 990901, SEED = 5000;
const PREFIX = "QA-EXPLIST-", MARK = `${PREFIX}${Date.now()}-`;
let db, browser, page, type;
const ok = ({ data, error }) => { if (error) throw new Error(error.message); return data; };
const cents = (v) => Math.round(Number(v) * 100);
const cleanup = async () => {
  ok(await db.from("tblexpenses").delete().like("expdscr", `${PREFIX}%`));
  ok(await db.from("tblexpenses").delete().eq("expcaseid", CASE));
  ok(await db.from("tblcase").delete().eq("caseid", CASE));
};
/** Every hosted 2026-01 row (paged past max-rows), for the expected count and total. */
async function januaryInDb() {
  const all = [];
  for (let from = 0; ; from += 1000) {
    const d = ok(await db.from("tblexpenses").select("expid, expamount").gte("expdate", "2026-01-01").lte("expdate", "2026-01-31").order("expid").range(from, from + 999));
    all.push(...d);
    if (d.length < 1000) return all;
  }
}
const fmt = (c) => `${c < 0 ? "-" : ""}${Math.trunc(Math.abs(c) / 100).toLocaleString("en-US")}.${String(Math.abs(c) % 100).padStart(2, "0")}`;

before(async () => {
  if (skip) return;
  db = createServerClient();
  await cleanup();
  type = ok(await db.from("tblexptype").select("exptypeid, exptype").order("exptypeid").limit(1).single());
  const src = ok(await db.from("tblcase").select("*").eq("caseid", 90001).single());
  ok(await db.from("tblcase").insert({ ...src, caseid: CASE }));
  ok(await db.from("tblexpenses").insert([10.25, 4.5, 0.1].map((a, i) => ({ expcaseid: CASE, exptype: type.exptypeid, expdate: `2026-0${i + 3}-10`, expdscr: `${MARK}case-${i}`, expchecknum: 100 + i, expamount: a, expbranch: "Stratford" }))));
  for (let b = 0; b < SEED; b += 1000) {
    ok(await db.from("tblexpenses").insert(Array.from({ length: 1000 }, (_, i) => ({
      expcaseid: null, exptype: type.exptypeid, expdate: `2026-01-${String(((b + i) % 31) + 1).padStart(2, "0")}`,
      expdscr: `${MARK}seed-${b + i}`, expchecknum: 0, expamount: 0.01 * (((b + i) % 97) + 1) + 0.00, expbranch: "Stratford",
    }))));
  }
  browser = await chromium.launch();
  page = await browser.newPage({ baseURL: BASE });
  for (let i = 0; ; i++) { // shared project → auth 429s; back off
    await page.goto("/login");
    await page.getByLabel(/email/i).fill(EMAIL);
    await page.getByLabel(/password/i).fill(process.env.E2E_PASSWORD ?? "password");
    await page.getByRole("button", { name: /sign in/i }).click();
    try { await page.waitForURL((u) => u.pathname !== "/login", { timeout: 20_000 }); break; } catch (e) { if (i >= 4) throw e; await page.waitForTimeout(3000 * (i + 1)); }
  }
});
after(async () => {
  await browser?.close();
  if (db) {
    await cleanup();
    assert.equal(ok(await db.from("tblexpenses").select("expid").like("expdscr", `${PREFIX}%`)).length, 0, "every seeded row removed");
  }
});

test(`/expenses?case=${CASE}: only that case's 3 rows, type name (not id), total 14.85`, { skip }, async () => {
  await page.goto(`/expenses?case=${CASE}`);
  const rows = page.locator("tbody tr");
  assert.equal(await rows.count(), 3);
  for (let i = 0; i < 3; i++) {
    assert.ok((await rows.nth(i).locator("td").nth(2).innerText()).startsWith(MARK), "row belongs to this run's case");
    assert.equal(await rows.nth(i).locator("td").nth(1).innerText(), type.exptype, "type name shown, not the id");
  }
  assert.equal(await page.getByTestId("expense-total").innerText(), "14.85");
});

test("/expenses?month=2026-01: every January row firm-wide (5,000 seeded + hosted), total = exact DB sum", { skip }, async () => {
  const want = await januaryInDb();
  assert.ok(want.length >= SEED);
  await page.goto("/expenses?month=2026-01", { timeout: 120_000 });
  assert.equal(await page.locator("tbody tr").count(), want.length, "row count = every 2026-01 row in the DB");
  assert.equal(await page.getByTestId("expense-total").innerText(), fmt(want.reduce((s, r) => s + cents(r.expamount), 0)));
  assert.ok(await page.locator("tbody tr", { hasText: `${MARK}seed-0` }).count() >= 1, "firm-wide (no case) row listed");
});

test("perf: median of 5 warm loads of /expenses?month=2026-01 < 1000ms", { skip }, async () => {
  await page.request.get("/expenses?month=2026-01"); // warm
  const ms = [];
  for (let i = 0; i < 5; i++) {
    const t = performance.now();
    const res = await page.request.get("/expenses?month=2026-01");
    const html = await res.text();
    ms.push(Math.round(performance.now() - t));
    assert.equal(res.status(), 200);
    assert.ok(html.includes(`${MARK}seed-${SEED - 1}`), "full list rendered");
  }
  const median = [...ms].sort((a, b) => a - b)[2];
  console.log(`expense-list perf timings ms: ${ms.join(", ")} median=${median}`);
  assert.ok(median < 1000, `median ${median}ms`);
});
