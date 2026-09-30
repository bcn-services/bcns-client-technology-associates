/**
 * Live check of /bills (billing item 6) through the real dev server (BASE_URL, default http://localhost:3100).
 * Skips when the server or SUPABASE_SERVICE_ROLE_KEY is unavailable. Seeds 5,000 bills (100 open "1st", 4,900 "Paid")
 * on invented cases 990700–990709 (copies of case 90001's tblcase row); everything on 990700–990799 is removed at
 * setup and in after(). Signs in as the E2E staff login (staff@example.test).
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
const CASES = Array.from({ length: 10 }, (_, i) => 990700 + i);
let db, browser, staff;
const ok = ({ data, error }) => { if (error) throw new Error(error.message); return data; };
const cleanup = async () => {
  ok(await db.from("tblbills").delete().gte("billcaseid", 990700).lte("billcaseid", 990799));
  ok(await db.from("tblcase").delete().gte("caseid", 990700).lte("caseid", 990799));
};

before(async () => {
  if (skip) return;
  db = createServerClient();
  await cleanup();
  const src = ok(await db.from("tblcase").select("*").eq("caseid", 90001).single());
  ok(await db.from("tblcase").insert(CASES.map((caseid) => ({ ...src, caseid }))));
  const bills = Array.from({ length: 5000 }, (_, i) => i < 100
    ? { billcaseid: CASES[i % 10], billdate: "2026-07-01", billhours: 1, billbalance: 100 + i, billnotice: "1st", billfilename: `Bill${CASES[i % 10]} Live ${i}` }
    : { billcaseid: CASES[i % 10], billdate: "2025-01-01", billhours: 1, billbalance: 50, billnotice: "Paid", billpaiddate: "2025-02-01" });
  for (let i = 0; i < bills.length; i += 1000) ok(await db.from("tblbills").insert(bills.slice(i, i + 1000)));
  browser = await chromium.launch();
  const ctx = await browser.newContext({ baseURL: BASE });
  staff = await ctx.newPage();
  for (let i = 0; ; i++) { // shared project → auth 429s; back off
    await staff.goto("/login");
    await staff.getByLabel(/email/i).fill(EMAIL);
    await staff.getByLabel(/password/i).fill(process.env.E2E_PASSWORD ?? "password");
    await staff.getByRole("button", { name: /sign in/i }).click();
    try { await staff.waitForURL((u) => u.pathname !== "/login", { timeout: 20_000 }); break; } catch (e) { if (i >= 4) throw e; await staff.waitForTimeout(3000 * (i + 1)); }
  }
});
after(async () => {
  await browser?.close();
  if (db) await cleanup();
});

test("staff GET /bills → 200 and sees the open-bills list with a seeded row linked to its case and bill", { skip }, async () => {
  const res = await staff.goto("/bills");
  assert.equal(res.status(), 200);
  assert.equal(await staff.getByRole("heading", { name: "Open bills" }).count(), 1);
  const row = staff.locator('tr[data-testid="open-bill"]', { hasText: "Bill990700 Live 0" });
  assert.equal(await row.count(), 1);
  assert.equal(await row.getByRole("link", { name: "990700", exact: true }).getAttribute("href"), "/cases/990700");
  assert.match(await row.getByRole("link", { name: "Bill990700 Live 0" }).getAttribute("href"), /^\/bills\/\d+$/);
  assert.equal(await staff.locator("main form").count(), 0);
});

test("median of 5 authenticated GET /bills with 5,000 bills seeded (100 open) < 1000 ms", { skip }, async () => {
  const get = async () => {
    const t = performance.now();
    const r = await staff.request.get("/bills");
    const body = await r.text();
    const ms = performance.now() - t;
    assert.equal(r.status(), 200);
    assert.ok(body.includes("Bill990709 Live 99"), "seeded open bill rendered");
    return ms;
  };
  await get(); // warm-up (dev compile)
  const times = [];
  for (let i = 0; i < 5; i++) times.push(await get());
  const median = [...times].sort((a, b) => a - b)[2];
  console.log(`# /bills render ms: ${times.map((t) => t.toFixed(0)).join(", ")} — median ${median.toFixed(0)}`);
  assert.ok(median < 1000, `median ${median.toFixed(0)} ms`);
});
