/**
 * Browser check of /time through the real page and addEntry action (dev server at BASE_URL,
 * default http://localhost:3100). Skips when unreachable or Supabase is unconfigured.
 * Uses fixture case 90001. Links the E2E staff login to personid 1 in before() and restores the
 * prior value in after(); every tblactivity row created after the run's starting max actid is removed.
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
const PERSON = 1;
let db, browser, page, startMax = 0, priorPersonId, captured;
const ok = ({ data, error }) => { if (error) throw new Error(error.message); return data; };
const setPerson = async (v) => ok(await db.from("profiles").update({ personid: v }).eq("email", EMAIL));
const ours = () => db.from("tblactivity").select("actid, actwho, actbilled, actbillid, acthrs, actcaseid").eq("actcaseid", 90001).or(`actwho.eq.${PERSON},actwho.is.null`).gt("actid", startMax);
// actwho null included: a broken personId-null refusal would insert such a row, and it must be counted and removed.
const cleanup = async () => ok(await db.from("tblactivity").delete().eq("actcaseid", 90001).or(`actwho.eq.${PERSON},actwho.is.null`).gt("actid", startMax));

before(async () => {
  if (skip) return;
  db = createServerClient();
  const [top] = ok(await db.from("tblactivity").select("actid").order("actid", { ascending: false }).limit(1));
  startMax = top?.actid ?? 0;
  priorPersonId = ok(await db.from("profiles").select("personid").eq("email", EMAIL).single()).personid;
  await setPerson(PERSON);
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

test("/time has exactly one Case, one Hours, one Description control and one add button; ?case= pre-fills", { skip }, async () => {
  await page.goto("/time?case=90001");
  assert.equal(await page.getByLabel(/case/i).count(), 1);
  assert.equal(await page.getByLabel(/hours/i).count(), 1);
  assert.equal(await page.getByLabel(/description/i).count(), 1);
  assert.equal(await page.getByRole("button", { name: /save|add entry/i }).count(), 1);
  assert.equal(await page.getByLabel(/case/i).inputValue(), "90001");
  assert.match(await page.getByLabel("Date").inputValue(), /^\d{4}-\d{2}-\d{2}$/);
});

test("linked staff: case 90001, 1.5h 'Reviewed file' → 'Entry added' and an unbilled row with actwho = personId", { skip }, async () => {
  await page.goto("/time");
  await page.getByLabel(/case/i).fill("90001");
  await page.getByLabel(/hours/i).fill("1.5");
  await page.getByLabel(/description/i).fill("Reviewed file");
  const req = page.waitForRequest((r) => r.method() === "POST" && !!r.headers()["next-action"]);
  await page.getByRole("button", { name: /save|add entry/i }).click();
  captured = await req;
  await page.getByText(/entry (added|saved)/i).waitFor();
  assert.equal(await page.getByText(/entry (added|saved)/i).count(), 1);
  const rows = ok(await ours());
  assert.equal(rows.length, 1);
  assert.deepEqual({ ...rows[0], actid: undefined, acthrs: Number(rows[0].acthrs) }, { actid: undefined, actwho: PERSON, actbilled: false, actbillid: null, acthrs: 1.5, actcaseid: 90001 });
});

test("hours 25 is refused on screen, typed values kept, nothing inserted", { skip }, async () => {
  const before = ok(await ours()).length;
  await page.goto("/time");
  await page.getByLabel(/case/i).fill("90001");
  await page.getByLabel(/hours/i).evaluate((el) => { el.removeAttribute("max"); el.value = "25"; });
  await page.getByLabel(/description/i).fill("Live refused");
  await page.getByRole("button", { name: /save|add entry/i }).click();
  await page.getByRole("alert").filter({ hasText: "Hours must be" }).waitFor();
  assert.equal(await page.getByLabel(/description/i).inputValue(), "Live refused");
  assert.equal(await page.getByLabel(/hours/i).inputValue(), "25");
  assert.equal(ok(await ours()).length, before);
});

test("personId null: not-linked message and no form; a replayed addEntry POST inserts nothing", { skip }, async () => {
  assert.ok(captured, "needs the captured action request from the happy-path test");
  const replay = () => page.request.fetch(captured.url(), {
    method: "POST",
    headers: Object.fromEntries(Object.entries(captured.headers()).filter(([k]) => ["next-action", "next-router-state-tree", "content-type", "accept"].includes(k))),
    data: captured.postDataBuffer(),
    maxRedirects: 0,
  });
  // Control: while linked, the replay does insert — so a refusal below is not a broken replay.
  const n0 = ok(await ours()).length;
  await replay();
  assert.equal(ok(await ours()).length, n0 + 1, "control replay while linked should insert");

  await setPerson(null);
  await page.goto("/time");
  await page.getByText("Your login isn't linked to a person — an admin can set it on /users").waitFor();
  assert.equal(await page.locator("form").filter({ has: page.getByLabel(/hours/i) }).count(), 0);
  assert.equal(await page.getByRole("button", { name: /add entry/i }).count(), 0);
  const n1 = ok(await ours()).length;
  await replay();
  assert.equal(ok(await ours()).length, n1, "unlinked replay must insert nothing");
  await setPerson(PERSON);
});
