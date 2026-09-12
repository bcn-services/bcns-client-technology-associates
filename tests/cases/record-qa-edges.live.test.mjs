/**
 * QA (attempt 3): browser value transformations that could desync from `__orig`, driven through the
 * real page + server action on the dev server (BASE_URL, default http://localhost:3104).
 * Snapshots fixture case 90001 and restores it.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { chromium } from "@playwright/test";
import { loadEnvLocal } from "../app-shell/seed-e2e.ts";
import { createServerClient } from "../../lib/db/client.ts";

loadEnvLocal();
const BASE = process.env.BASE_URL ?? "http://localhost:3104";
const ID = 90001;
const up = await fetch(`${BASE}/login`).then((r) => r.ok, () => false);
const skip = up && process.env.SUPABASE_SERVICE_ROLE_KEY ? false : "dev server or Supabase unavailable";
let db, snapshot, browser, page;
const ok = ({ data, error }) => { if (error) throw new Error(error.message); return data; };
const readCase = async () => ok(await db.from("tblcase").select("*").eq("caseid", ID).single());

before(async () => {
  if (skip) return;
  db = createServerClient();
  snapshot = await readCase();
  browser = await chromium.launch();
  page = await browser.newPage({ baseURL: BASE });
  page.on("dialog", (d) => d.dismiss());
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
  if (snapshot) { const { caseid, ...rest } = snapshot; ok(await db.from("tblcase").update(rest).eq("caseid", caseid)); }
});

const save = async (fill) => {
  await page.goto(`/cases/${ID}`);
  await page.getByRole("button", { name: "Unlock" }).click();
  await fill();
  const prev = page.url();
  await page.getByRole("button", { name: "Save" }).click();
  await page.waitForURL((u) => u.href !== prev && /saved=|error=/.test(u.href));
  return page.url();
};

// Legacy values a browser could transform. Each is applied separately; a DB constraint rejecting one just drops it.
const EDGES = {
  casesubject: "line1\r\nline2",           // CRLF in a single-line input
  casestatduedatedescription: "a\nb",      // newline in the datalist input
  otherexperts: "  padded  ",              // leading/trailing spaces
  billingcc: "x".repeat(600),              // long value (no maxlength truncation expected)
  casenotes: "\n\nlead",                   // textarea: HTML parser drops one leading newline
  casecaption: "\r\n",                     // textarea holding only a line break
  casestatpointman: "legacy pm",           // off-list point man
  casestatpriority: "HIGH",                // case-mismatched priority (FK may reject)
  casestatwaitingfor: "zz legacy",         // off-list waiting-for (FK may reject)
};
let applied = {};

test("untouched save of a row with browser-transformable legacy values writes nothing", { skip }, async () => {
  for (const [c, v] of Object.entries(EDGES)) {
    const { error } = await db.from("tblcase").update({ [c]: v }).eq("caseid", ID);
    if (!error) applied[c] = v;
  }
  console.log("# applied edges:", Object.keys(applied).join(","));
  const before = await readCase();
  const url = await save(async () => {});
  const after = await readCase();
  assert.deepEqual({ saved0: /saved=0/.test(url), row: after }, { saved0: true, row: before }, `applied: ${Object.keys(applied)}`);
});

test("editing only notes leaves every transformable legacy value and casestatlastupdated intact", { skip }, async () => {
  const before = await readCase();
  const url = await save(() => page.locator("#f-casenotes").fill("qa edges notes"));
  const after = await readCase();
  assert.match(url, /saved=1/);
  assert.equal(after.casenotes, "qa edges notes");
  assert.deepEqual({ ...after, casenotes: null }, { ...before, casenotes: null });
});

test("a genuine edit to a single-line field with a legacy newline saves what was typed", { skip }, async () => {
  const url = await save(() => page.locator("#f-casesubject").fill("qa edited subject"));
  assert.match(url, /saved=1/);
  assert.equal((await readCase()).casesubject, "qa edited subject");
});

test("?error= shows fixed text for known codes and the generic message otherwise", { skip }, async () => {
  const alert = async (q) => { await page.goto(`/cases/${ID}?${q}`); return page.locator("main").getByRole("alert").innerText(); };
  assert.equal(await alert("error=required%3Acasetitle"), "Title is required");
  assert.equal(await alert("error=%3Cb%3Einjected%3C%2Fb%3E"), "Save failed; nothing was changed.");
  assert.equal(await alert("error=int%3Anumunpaidbills"), "Save failed; nothing was changed.");
  assert.equal(await alert("error=notfound&error=x"), "This case no longer exists.");
});
