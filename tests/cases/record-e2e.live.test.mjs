/**
 * Browser QA for the case record through the real server action (dev server at BASE_URL,
 * default http://localhost:3104). Skips when BASE_URL is unreachable or Supabase is unconfigured.
 * Snapshots fixture case 90001 and restores it.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { chromium } from "@playwright/test";
import { loadEnvLocal } from "../app-shell/seed-e2e.ts";
import { createServerClient } from "../../lib/db/client.ts";
import { ensureSecondPriority } from "./seed-fixtures.ts";

loadEnvLocal();
const BASE = process.env.BASE_URL ?? "http://localhost:3104";
const ID = 90001;
const up = await fetch(`${BASE}/login`).then((r) => r.ok, () => false);
const skip = up && process.env.SUPABASE_SERVICE_ROLE_KEY ? false : "dev server or Supabase unavailable";
let db, snapshot, browser, page, dropTempPriority;
const ok = ({ data, error }) => { if (error) throw new Error(error.message); return data; };
const readCase = async () => ok(await db.from("tblcase").select("*").eq("caseid", ID).single());

before(async () => {
  if (skip) return;
  db = createServerClient();
  dropTempPriority = await ensureSecondPriority(db); // the priority test needs a second option; heals a crashed run first
  snapshot = await readCase();
  browser = await chromium.launch();
  page = await browser.newPage({ baseURL: BASE });
  page.on("dialog", (d) => d.dismiss());
  for (let i = 0; ; i++) { // shared project → auth 429s; back off
    await page.goto("/login");
    await page.getByLabel(/email/i).fill(process.env.E2E_EMAIL ?? "staff@example.test");
    await page.getByLabel(/password/i).fill(process.env.E2E_PASSWORD ?? "password");
    await page.getByRole("button", { name: /sign in/i }).click();
    try { await page.waitForURL((u) => u.pathname !== "/login", { timeout: 20_000 }); break; } catch (e) { if (i >= 4) throw e; await page.waitForTimeout(3000 * (i + 1)); }
  }
});
after(async () => {
  await browser?.close();
  if (snapshot) { const { caseid, ...rest } = snapshot; ok(await db.from("tblcase").update(rest).eq("caseid", caseid)); }
  await dropTempPriority?.(); // after the restore: 90001 may point at it
});

const unlockAndSave = async (fill) => {
  await page.getByRole("button", { name: "Unlock" }).click();
  await fill();
  const prev = page.url();
  await page.getByRole("button", { name: "Save" }).click();
  await page.waitForURL((u) => u.href !== prev && /saved=|error=/.test(u.href));
};

test("record opens locked, shows fixture values, attorney, firm, client, slots; no delete control", { skip }, async () => {
  await page.goto(`/cases/${ID}`);
  const main = page.locator("main");
  await assert.doesNotReject(main.getByRole("heading", { name: new RegExp(String(ID)) }).waitFor());
  const text = await main.innerText();
  for (const s of ["Pat Example", "Example & Partners LLP", "Sam Sample", "Bills", "Funds received", "Expenses"]) assert.ok(text.includes(s), s);
  assert.equal(await page.locator("#f-casetitle").inputValue(), snapshot.casetitle);
  assert.equal(await page.locator("#f-casestartdate").inputValue(), String(snapshot.casestartdate).slice(0, 10));
  assert.equal(await page.locator("#f-status").inputValue(), snapshot.status);
  assert.equal(await page.locator("#f-tabranch").inputValue(), snapshot.tabranch);
  assert.equal(await page.locator("#f-casestatpriority").inputValue(), snapshot.casestatpriority);
  assert.equal(await page.locator("#f-casestatwaitingfor").inputValue(), snapshot.casestatwaitingfor);
  assert.equal(await page.locator("#f-caseinquiry").inputValue(), String(snapshot.caseinquiry));
  assert.ok(await page.locator("#f-casetitle").isDisabled(), "opens locked");
  assert.equal(await page.getByRole("button", { name: /delete/i }).count(), 0);
});

test("unchanged save through the action writes nothing", { skip }, async () => {
  await page.goto(`/cases/${ID}`);
  const before = await readCase();
  await unlockAndSave(async () => {});
  assert.match(page.url(), /saved=0/);
  assert.deepEqual(await readCase(), before);
});

test("priority change through the action stamps now; notes-only does not", { skip }, async () => {
  await page.goto(`/cases/${ID}`);
  const t0 = Date.now();
  const other = await page.locator("#f-casestatpriority option").evaluateAll((os, cur) => os.map((o) => o.value).find((v) => v && v !== cur), snapshot.casestatpriority);
  await unlockAndSave(() => page.locator("#f-casestatpriority").selectOption(other));
  const a = await readCase();
  assert.notEqual(a.casestatpriority, snapshot.casestatpriority);
  assert.ok(Math.abs(Date.parse(a.casestatlastupdated) - t0) < 60_000, "stamped now");
  await unlockAndSave(() => page.locator("#f-casenotes").fill(`qa e2e ${t0}`));
  const b = await readCase();
  assert.equal(b.casenotes, `qa e2e ${t0}`);
  assert.equal(b.casestatlastupdated, a.casestatlastupdated);
  assert.equal(b.numunpaidbills, snapshot.numunpaidbills);
  assert.equal(b.numunapprovedsa, snapshot.numunapprovedsa);
});

test("stale editor through the action: notes-only save must not revert an out-of-band change", { skip }, async () => {
  await page.goto(`/cases/${ID}`);
  await page.getByRole("button", { name: "Unlock" }).click();
  ok(await db.from("tblcase").update({ casesubject: "QA out-of-band" }).eq("caseid", ID));
  await page.locator("#f-casenotes").fill(`qa stale ${Date.now()}`);
  await page.getByRole("button", { name: "Save" }).click();
  await page.waitForURL(/saved=|error=/);
  assert.equal((await readCase()).casesubject, "QA out-of-band", "stale form reverted casesubject");
});

test("tampered POST through the action: forged __orig, non-editable and unknown keys, missing __orig write nothing", { skip }, async () => {
  await page.goto(`/cases/${ID}`);
  const before = await readCase();
  await unlockAndSave(() => page.evaluate(() => {
    const form = document.querySelector("#f-casenotes").form;
    const add = (n, v) => { const i = document.createElement("input"); i.type = "hidden"; i.name = n; i.value = v; form.append(i); };
    for (const [n, v] of [["numunpaidbills", "99"], ["numunpaidbills__orig", "0"], ["numunapprovedsa", "99"], ["numunapprovedsa__orig", "0"],
      ["casestatlastupdated", "2000-01-01T00:00:00Z"], ["casestatlastupdated__orig", "x"], ["casenum", "999"], ["casenum__orig", "1"],
      ["caseid", "1"], ["bogus_col", "1"], ["bogus_col__orig", "0"]]) add(n, v);
    form.querySelector('[name="casesubject__orig"]').remove();
    document.querySelector("#f-casesubject").value = "QA tamper no orig";
  }));
  assert.match(page.url(), /saved=0/);
  assert.deepEqual(await readCase(), before);
});

test("unchanged save through the action: CRLF / leading-newline textarea values write nothing", { skip }, async () => {
  ok(await db.from("tblcase").update({ casenotes: "\nlead\r\nline  ", casecaption: "x\ny\n", casestatdescription: "a\r\n\r\nb" }).eq("caseid", ID));
  await page.goto(`/cases/${ID}`);
  const before = await readCase();
  await unlockAndSave(async () => {});
  assert.match(page.url(), /saved=0/);
  assert.deepEqual(await readCase(), before);
});

test("unchanged save through the action: legacy newline in a single-line field writes nothing", { skip }, async () => {
  ok(await db.from("tblcase").update({ casesubject: "line1\nline2", otherexperts: "  padded  " }).eq("caseid", ID));
  await page.goto(`/cases/${ID}`);
  const before = await readCase();
  await unlockAndSave(async () => {});
  const after = await readCase();
  assert.deepEqual({ url: /saved=0/.test(page.url()), casesubject: after.casesubject, otherexperts: after.otherexperts },
    { url: true, casesubject: before.casesubject, otherexperts: before.otherexperts });
});

test("non-numeric id 404s; array searchParams do not 500", { skip }, async () => {
  assert.equal((await page.goto("/cases/abc")).status(), 404);
  assert.equal((await page.goto(`/cases/${ID}?saved=1&saved=0&error=x&error=y&t=1&t=2`)).status(), 200);
  assert.equal((await page.goto(`/cases/${ID}/rolodex`)).status(), 200);
  assert.ok((await page.locator("body").innerText()).includes("Example, Pat"));
});
