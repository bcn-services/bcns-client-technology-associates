/**
 * Browser check of the header running-timer indicator (dev server at BASE_URL, default http://localhost:3100).
 * Skips when unreachable or Supabase is unconfigured. The Add-entry path inserts on invented case 990402
 * (a copy of case 90001's tblcase row); links the E2E staff login to personid 1 in before(), restores it in
 * after(); every tblactivity row by person 1 or with null actwho, on ANY case, created after the starting max actid is removed.
 * Guards are named "guard <letter>" to match mutation targets.
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
const PERSON = 1, CASE = 990402, KEY = "ta.timer", MIN = 60_000;
let db, browser, ctx, page, startMax = 0, priorPersonId, baselineHeader, baselineFirm;
const ok = ({ data, error }) => { if (error) throw new Error(error.message); return data; };
const setPerson = async (v) => ok(await db.from("profiles").update({ personid: v }).eq("email", EMAIL));
const cleanupRows = async () => ok(await db.from("tblactivity").delete().or(`actwho.eq.${PERSON},actwho.is.null`).gt("actid", startMax));
const ind = (p = page) => p.getByTestId("running-indicator");
const clearKey = (p = page) => p.evaluate((k) => localStorage.removeItem(k), KEY);
const seed = (p, minutesAgo, caseId = "90001") => p.evaluate(([k, v]) => localStorage.setItem(k, v), [KEY, JSON.stringify({ caseId, startedAt: Date.now() - minutesAgo * MIN, description: "Indicator work" })]);
const minutes = async (p = page) => { const m = /· (\d+):(\d\d)/.exec(await ind(p).textContent()); assert.ok(m, "indicator shows h:mm"); return +m[1] * 60 + +m[2]; };
const headerText = () => page.locator("header").innerText();

before(async () => {
  if (skip) return;
  db = createServerClient();
  const [top] = ok(await db.from("tblactivity").select("actid").order("actid", { ascending: false }).limit(1));
  startMax = top?.actid ?? 0;
  priorPersonId = ok(await db.from("profiles").select("personid").eq("email", EMAIL).single()).personid;
  await setPerson(PERSON);
  ok(await db.from("tblcase").delete().eq("caseid", CASE));
  const src = ok(await db.from("tblcase").select("*").eq("caseid", 90001).single());
  ok(await db.from("tblcase").insert({ ...src, caseid: CASE }));
  browser = await chromium.launch();
  ctx = await browser.newContext({ baseURL: BASE });
  page = await ctx.newPage();
});
after(async () => {
  await browser?.close();
  if (db) { await cleanupRows(); ok(await db.from("tblcase").delete().eq("caseid", CASE)); await setPerson(priorPersonId ?? null); }
});

test("guard j: signed-out /login shows no indicator even with a timer stored", { skip }, async () => {
  await page.goto("/login");
  await seed(page, 5);
  await page.reload();
  await page.waitForTimeout(1000); // let any effect run
  assert.equal(await ind().count(), 0);
  await clearKey();
  for (let i = 0; ; i++) { // shared project → auth 429s; back off
    await page.goto("/login");
    await page.getByLabel(/email/i).fill(EMAIL);
    await page.getByLabel(/password/i).fill(process.env.E2E_PASSWORD ?? "password");
    await page.getByRole("button", { name: /sign in/i }).click();
    try { await page.waitForURL((u) => u.pathname !== "/login", { timeout: 20_000 }); break; } catch (e) { if (i >= 4) throw e; await page.waitForTimeout(3000 * (i + 1)); }
  }
});

test("no timer: header has no indicator (baseline recorded)", { skip }, async () => {
  await clearKey();
  await page.goto("/cases/90001");
  await page.locator("header").waitFor();
  await page.waitForTimeout(1000);
  assert.equal(await ind().count(), 0);
  baselineHeader = await headerText();
  baselineFirm = await page.getByText(/firm/i).count();
});

test("guard f/d/k: Start on /time shows the indicator without navigation; it links to /time and keeps /time's labels strict", { skip }, async () => {
  await page.goto("/time");
  await page.getByLabel(/case/i).fill("90001");
  await page.getByRole("button", { name: "Start timer" }).click();
  await page.getByRole("timer").waitFor();
  // Same tab, same pathname, well inside the 60 s tick: only the same-tab event can show it.
  await ind().waitFor({ timeout: 5000 });
  assert.match(await ind().textContent(), /^⏱ Case 90001 · \d+:\d\d$/);
  assert.equal(await ind().getAttribute("href"), "/time"); // guard d
  // guard k: no accessible-name attributes; journey 03's getByLabel selectors still resolve to one element.
  for (const a of ["aria-label", "title", "aria-labelledby"]) assert.equal(await ind().getAttribute(a), null, a);
  for (const re of [/case/i, /hours/i, /description/i]) assert.equal(await page.getByLabel(re).count(), 1, String(re));
});

test("guard f: header link click to / and then /cases/90001 keep showing Case 90001 without reload", { skip }, async () => {
  await page.getByRole("link", { name: "Technology Associates" }).click();
  await page.waitForURL((u) => u.pathname === "/");
  assert.match(await ind().textContent(), /^⏱ Case 90001 · 0:0\d$/);
  assert.equal(await ind().getAttribute("href"), "/time");
  await page.goto("/cases/90001");
  await ind().waitFor();
  assert.match(await ind().textContent(), /Case 90001 · \d+:\d\d/);
  assert.equal(await ind().getAttribute("href"), "/time");
  assert.equal(await page.getByText(/firm/i).count(), baselineFirm, "journey 02's /firm/i count unchanged");
  for (const re of [/attorney/i, /client/i]) assert.doesNotMatch(await ind().textContent(), re);
  await ind().click();
  await page.waitForURL((u) => u.pathname === "/time");
});

test("guard g: Stop shows 'stopped', Discard removes the indicator; header then equals the no-timer baseline", { skip }, async () => {
  await page.getByRole("button", { name: "Stop" }).click();
  await page.waitForFunction(() => /stopped$/.test(document.querySelector('[data-testid="running-indicator"]')?.textContent ?? ""));
  await page.getByRole("button", { name: "Discard" }).click();
  await ind().waitFor({ state: "detached", timeout: 5000 });
  await page.goto("/cases/90001");
  await page.waitForTimeout(1000);
  assert.equal(await ind().count(), 0);
  assert.equal(await headerText(), baselineHeader);
});

test("guard g: Add entry of a stopped timer removes the indicator", { skip }, async () => {
  await page.goto("/time");
  await page.getByLabel(/case/i).fill(String(CASE));
  await page.getByRole("button", { name: "Start timer" }).click();
  await ind().waitFor({ timeout: 5000 });
  await page.getByRole("button", { name: "Stop" }).click();
  await page.getByLabel(/description/i).fill("Indicator work");
  await page.getByRole("button", { name: /save|add entry/i }).click();
  await page.getByText(/entry added/i).waitFor();
  await ind().waitFor({ state: "detached", timeout: 5000 });
  assert.equal(await page.evaluate((k) => localStorage.getItem(k), KEY), null);
});

test("guard e: elapsed advances on the minute tick without reload or navigation", { skip }, async () => {
  const p = await ctx.newPage(); // fresh page so the fake clock is installed before any script runs
  await p.clock.install();
  await p.goto("/");
  await seed(p, 7);
  await p.reload();
  await ind(p).waitFor();
  const m1 = await minutes(p);
  assert.ok(m1 >= 6 && m1 <= 8, `seeded ~7 min, got ${m1}`);
  await p.clock.runFor(61_000);
  await p.waitForFunction((m) => {
    const t = /· (\d+):(\d\d)/.exec(document.querySelector('[data-testid="running-indicator"]')?.textContent ?? "");
    return t && +t[1] * 60 + +t[2] > m;
  }, m1, { timeout: 5000 });
  await clearKey(p);
  await p.close();
});
