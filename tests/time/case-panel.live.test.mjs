/**
 * Browser check of the case page "Time" panel (dev server at BASE_URL, default http://localhost:3100).
 * Skips when unreachable or Supabase is unconfigured. Reads fixture case 90001 (actid 1 KJS, actid 2 JON billed).
 * Links the E2E staff login to personid 1 in before() and restores the prior value in after().
 * after() removes every tblactivity row on case 90001 with actid > the starting max (any actwho, incl. null);
 * fixture rows 1 and 2 are never written.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { chromium } from "@playwright/test";
import { loadEnvLocal } from "../app-shell/seed-e2e.ts";
import { createServerClient } from "../../lib/db/client.ts";

loadEnvLocal();
const BASE = process.env.BASE_URL ?? "http://localhost:3100";
const EMAIL = process.env.E2E_EMAIL ?? "staff@example.test";
const up = await fetch(`${BASE}/login`).then((r) => r.ok, () => false);
const skip = up && process.env.SUPABASE_SERVICE_ROLE_KEY ? false : "dev server or Supabase unavailable";
let db, browser, page, startMax = 0, priorPersonId;
const ok = ({ data, error }) => { if (error) throw new Error(error.message); return data; };
const setPerson = async (v) => ok(await db.from("profiles").update({ personid: v }).eq("email", EMAIL));
const cleanup = async () => ok(await db.from("tblactivity").delete().eq("actcaseid", 90001).gt("actid", Math.max(startMax, 2)));
const panel = () => page.getByTestId("time-panel");
const norm = (s) => s.replace(/\s+/g, " ").trim();
const unbilled = async () => {
  const m = norm(await panel().getByTestId("unbilled-hours").innerText()).match(/^Unbilled hours: (\d+\.\d{3})$/);
  assert.ok(m, "unbilled line shape");
  return Math.round(Number(m[1]) * 1000);
};

before(async () => {
  if (skip) return;
  db = createServerClient();
  const [top] = ok(await db.from("tblactivity").select("actid").eq("actcaseid", 90001).order("actid", { ascending: false }).limit(1));
  startMax = top?.actid ?? 0;
  priorPersonId = ok(await db.from("profiles").select("personid").eq("email", EMAIL).single()).personid;
  await setPerson(1);
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
  if (db) { await cleanup(); await setPerson(priorPersonId ?? null); }
});

test("live A: /cases/90001 Time panel shows KJS (unbilled) and JON (billed) rows, adds no /bills/ or /firm|attorney|client/ text", { skip }, async () => {
  await page.goto("/cases/90001");
  await panel().getByRole("heading", { name: "Time" }).waitFor();
  const kjs = panel().getByTestId("time-row").filter({ hasText: "Site inspection" });
  const jon = panel().getByTestId("time-row").filter({ hasText: "Photo review" });
  assert.match(norm(await kjs.innerText()), /KJS 2\.000 Site inspection$/);
  assert.equal(await kjs.getByTestId("billed-marker").count(), 0);
  assert.match(norm(await jon.innerText()), /JON 1\.500 Photo review billed$/);
  assert.equal(await jon.getByTestId("billed-marker").count(), 1);
  await unbilled();
  const text = await panel().innerText();
  assert.doesNotMatch(text, /bills/i, "panel adds no /bills/i text (journey 01)");
  assert.doesNotMatch(text, /firm|attorney|client/i, "panel adds no journey-02 text");
  assert.equal(await panel().getByRole("heading", { name: /bills/i }).count(), 0);
  // Journey 01's heading ambiguity predates this panel; prove the panel contributes none of the page's matches.
  const outside = (loc) => loc.evaluateAll((els) => els.filter((e) => !e.closest("#time-panel")).length);
  const headings = page.getByRole("heading", { name: /bills/i });
  console.log(`note: /bills/i headings on the case page: ${JSON.stringify(await headings.allInnerTexts())}`);
  assert.equal(await headings.count(), 1, "only the existing Bills slot heading");
  assert.equal(await outside(headings), await headings.count(), "every /bills/i heading lies outside the Time panel");
  const texts = page.getByText(/bills/i);
  assert.equal(await outside(texts), await texts.count(), "every /bills/i text lies outside the Time panel");
  assert.equal(await panel().getByRole("button").count(), 0, "panel is read-only: links, no buttons");
});

test("live B: panel 'Add entry' → /time?case=90001 pre-filled; the new entry tops the panel and raises unbilled by its hours", { skip }, async () => {
  await page.goto("/cases/90001");
  const u0 = await unbilled();
  if (u0 !== 2000) console.log(`note: starting unbilled on 90001 is ${(u0 / 1000).toFixed(3)}, not 2.000 — stray rows on the fixture case`);
  await panel().getByRole("link", { name: "Add entry" }).click();
  await page.waitForURL((u) => u.pathname === "/time" && u.searchParams.get("case") === "90001");
  assert.equal(await page.locator("#t-case").inputValue(), "90001");
  const desc = `Panel live ${randomUUID().slice(0, 8)}`;
  await page.locator("#t-hours").fill("0.375");
  await page.locator("#t-description").fill(desc);
  await page.getByRole("button", { name: /add entry/i }).click();
  await page.getByText(/entry added/i).waitFor();
  await page.goto("/cases/90001");
  const firstRow = norm(await panel().getByTestId("time-row").first().innerText());
  assert.match(firstRow, new RegExp(`KJS 0\\.375 ${desc}$`));
  assert.equal(await unbilled(), u0 + 375);
});
