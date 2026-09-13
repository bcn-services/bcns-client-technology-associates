/**
 * Browser check of the /time start/stop timer (dev server at BASE_URL, default http://localhost:3100).
 * Skips when unreachable or Supabase is unconfigured. Timer rows go on invented case 990401 (a copy of
 * case 90001's tblcase row). Links the E2E staff login to personid 1 in before(), restores it in after();
 * every tblactivity row by person 1 or with null actwho, on ANY case, created after the starting max actid is removed.
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
const PERSON = 1, CASE = 990401, KEY = "ta.timer", MIN = 60_000;
let db, browser, page, startMax = 0, priorPersonId;
const ok = ({ data, error }) => { if (error) throw new Error(error.message); return data; };
const setPerson = async (v) => ok(await db.from("profiles").update({ personid: v }).eq("email", EMAIL));
// Any case, actwho = PERSON or null: every row a timer bug could write.
const newRows = async () => ok(await db.from("tblactivity").select("actid, actcaseid, acthrs, actwho, actdescription").or(`actwho.eq.${PERSON},actwho.is.null`).gt("actid", startMax));
const cleanupRows = async () => ok(await db.from("tblactivity").delete().or(`actwho.eq.${PERSON},actwho.is.null`).gt("actid", startMax));
const getKey = () => page.evaluate((k) => localStorage.getItem(k), KEY);
const seed = (minutesAgo, extra = {}) => page.evaluate(([k, v]) => localStorage.setItem(k, v), [KEY, JSON.stringify({ caseId: String(CASE), startedAt: Date.now() - minutesAgo * MIN, description: "Timed work", ...extra })]);
const elapsedSec = async () => { const [h, m, s] = (await page.getByRole("timer").textContent()).split(":").map(Number); return h * 3600 + m * 60 + s; };
const addEntry = () => page.getByRole("button", { name: /save|add entry/i });

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
  if (db) { await cleanupRows(); ok(await db.from("tblcase").delete().eq("caseid", CASE)); await setPerson(priorPersonId ?? null); }
});

test("?case=90001 pre-fills Case and Start stores a timer for 90001; empty Case is refused", { skip }, async () => {
  await page.goto("/time");
  await page.evaluate((k) => localStorage.removeItem(k), KEY);
  await page.goto("/time?case=90001");
  assert.equal(await page.getByLabel(/case/i).inputValue(), "90001");
  await page.getByRole("button", { name: "Start timer" }).click();
  await page.getByRole("timer").waitFor();
  const k = JSON.parse(await getKey());
  assert.equal(k.caseId, "90001");
  assert.ok(Math.abs(Date.now() - k.startedAt) < 60_000);
  await page.evaluate((key) => localStorage.removeItem(key), KEY); // never insert on 90001
  await page.goto("/time");
  await page.getByLabel(/case/i).fill("");
  await page.getByRole("button", { name: "Start timer" }).click();
  await page.getByText("Enter a case number first").waitFor();
  assert.equal(await getKey(), null);
});

test("journey 03 selectors stay strict with the timer running and stopped (getByLabel case/hours/description = 1 each)", { skip }, async () => {
  await page.goto("/time");
  await seed(5);
  await page.reload();
  await page.getByRole("timer").waitFor();
  for (const phase of ["running", "stopped"]) {
    for (const re of [/case/i, /hours/i, /description/i]) assert.equal(await page.getByLabel(re).count(), 1, `${phase} ${re}`);
    assert.equal(await addEntry().count(), 1, phase);
    assert.equal(await page.getByText(/entry (added|saved)/i).count(), 0, phase);
    if (phase === "running") await page.getByRole("button", { name: "Stop" }).click();
  }
  await page.evaluate((k) => localStorage.removeItem(k), KEY);
});

test("reload mid-run keeps ticking from the stored start and Start is refused; Stop → Add entry inserts rounded hours and clears the key", { skip }, async () => {
  await page.goto("/time");
  await seed(40);
  await page.reload();
  await page.getByRole("timer").waitFor();
  const t1 = await elapsedSec();
  assert.ok(t1 >= 40 * 60 && t1 < 41 * 60, `elapsed ${t1}s should count from the seeded start`);
  await page.waitForTimeout(1500);
  assert.ok((await elapsedSec()) > t1, "timer should tick");
  await page.getByRole("button", { name: "Start timer" }).click();
  await page.getByText("Stop the running timer first").waitFor();
  assert.equal(JSON.parse(await getKey()).startedAt <= Date.now() - 40 * MIN, true, "refused Start must not overwrite the key");

  await page.getByRole("button", { name: "Stop" }).click();
  assert.equal(await page.getByLabel(/hours/i).inputValue(), "0.625");
  assert.equal(await page.getByLabel(/case/i).inputValue(), String(CASE));
  assert.equal(await page.getByLabel(/description/i).inputValue(), "Timed work");
  assert.match(await page.getByLabel("Date").inputValue(), /^\d{4}-\d{2}-\d{2}$/);
  assert.ok(JSON.parse(await getKey()).stoppedAt, "key kept (stopped) until the entry is added");
  assert.equal((await newRows()).length, 0, "Stop alone must not write to the database");

  await addEntry().click();
  await page.getByText(/entry added/i).waitFor();
  await page.waitForFunction((k) => localStorage.getItem(k) === null, KEY);
  const rows = await newRows();
  assert.deepEqual(rows.map((r) => [r.actcaseid, Number(r.acthrs), r.actwho, r.actdescription]), [[CASE, 0.625, PERSON, "Timed work"]]);
  assert.equal(await page.getByRole("timer").count(), 0, "timer panel goes idle after the add (no stale Discard)");
  assert.equal(await page.getByRole("button", { name: "Discard" }).count(), 0);
  assert.equal(await page.getByLabel(/hours/i).inputValue(), "", "form resets after the add");
  assert.equal(await page.getByLabel(/description/i).inputValue(), "");

  // A second add from /time?added=1 redirects to the same URL; the form must still reset.
  await page.getByLabel(/case/i).fill(String(CASE));
  await page.getByLabel(/hours/i).fill("0.5");
  await page.getByLabel(/description/i).fill("Second add");
  await addEntry().click();
  await page.waitForFunction(() => document.getElementById("t-description")?.value === "", null, { timeout: 15_000 });
  assert.equal(await page.getByLabel(/hours/i).inputValue(), "");
  assert.deepEqual((await newRows()).map((r) => r.actdescription).sort(), ["Second add", "Timed work"]);
  await page.getByLabel(/case/i).fill(String(CASE));
  await page.getByRole("button", { name: "Start timer" }).click();
  await page.getByRole("timer").waitFor();
  assert.equal(JSON.parse(await getKey()).caseId, String(CASE), "Start works again after a successful add");
  await page.evaluate((k) => localStorage.removeItem(k), KEY);
});

test("a refused submit (?error=) keeps the stopped timer's key and inserts nothing", { skip }, async () => {
  const n = (await newRows()).length;
  await page.goto("/time");
  await seed(40, { stoppedAt: Date.now() });
  await page.reload();
  await page.getByRole("button", { name: "Discard" }).waitFor();
  assert.equal(await page.getByLabel(/hours/i).inputValue(), "0.625");
  await page.getByLabel(/hours/i).evaluate((el) => { el.removeAttribute("max"); el.value = "25"; });
  await addEntry().click();
  await page.waitForURL(/error=/);
  await page.getByRole("alert").filter({ hasText: "Hours must be" }).waitFor();
  await page.getByRole("button", { name: "Discard" }).waitFor();
  assert.ok(JSON.parse(await getKey()).stoppedAt, "key must survive a refused submit");
  assert.equal(await page.getByLabel(/hours/i).inputValue(), "25", "typed values echoed by ?error= are not overwritten");
  assert.equal((await newRows()).length, n);
  await page.evaluate((k) => localStorage.removeItem(k), KEY);
});

test("Discard clears the key, empties Hours, and inserts nothing on any case", { skip }, async () => {
  const before = (await newRows()).map((r) => r.actid);
  await page.goto("/time");
  await seed(40);
  await page.reload();
  await page.getByRole("button", { name: "Stop" }).click();
  assert.equal(await page.getByLabel(/hours/i).inputValue(), "0.625");
  await page.getByRole("button", { name: "Discard" }).click();
  await page.waitForTimeout(2000); // give a stray submit time to land
  assert.equal(await getKey(), null);
  assert.equal(await page.getByLabel(/hours/i).inputValue(), "");
  assert.equal(await page.getByText(/entry added/i).count(), 0);
  assert.deepEqual((await newRows()).map((r) => r.actid), before, "Discard must not insert");
});
