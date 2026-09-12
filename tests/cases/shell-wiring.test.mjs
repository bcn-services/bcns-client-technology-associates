/**
 * Shell wiring for the cases lane: Inquiries in SECTIONS, and the two home-page quick-search boxes.
 * Source-level checks always run; the HTTP check needs a dev server on BASE_URL (default http://localhost:3109) and skips without one.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { SECTIONS } from "../../lib/auth/sections.ts";

const ORIGINAL = ["/cases", "/time", "/bills", "/expenses", "/funds", "/bank-review", "/documents", "/reports", "/dashboard"];
const page = readFileSync(new URL("../../app/page.tsx", import.meta.url), "utf8");
/** The body of the first <form ...action="X"...>...</form> in the page source, or null. */
const formBody = (html, action) => {
  const m = new RegExp(`<form\\b[^>]*\\baction="${action.replace("/", "\\/")}"[^>]*>([\\s\\S]*?)</form>`).exec(html);
  return m ? m[1] : null;
};
const hasQ = (body) => /<input\b[^>]*\bname="q"/.test(body ?? "");

test("SECTIONS includes the Inquiries entry", () => {
  assert.ok(SECTIONS.some((s) => s.href === "/inquiries" && s.label === "Inquiries"), JSON.stringify(SECTIONS));
});
test("SECTIONS includes Firms, Attorneys, Clients", () => {
  for (const h of ["/firms", "/attorneys", "/clients"]) assert.ok(SECTIONS.some((s) => s.href === h), `missing ${h}`);
});
test("SECTIONS keeps all nine original hrefs", () => {
  const hrefs = SECTIONS.map((s) => s.href);
  for (const h of ORIGINAL) assert.ok(hrefs.includes(h), `missing ${h}`);
});
test("home page has a GET form with action=/cases", () => {
  assert.ok(formBody(page, "/cases") !== null);
});
test("home case form has an input named q", () => {
  assert.ok(hasQ(formBody(page, "/cases")));
});
test("home page has a GET form with action=/inquiries", () => {
  assert.ok(formBody(page, "/inquiries") !== null);
});
test("home inquiry form has an input named q", () => {
  assert.ok(hasQ(formBody(page, "/inquiries")));
});

// --- HTTP -------------------------------------------------------------------------------------------
const { loadEnvLocal, seedE2eUser } = await import("../app-shell/seed-e2e.ts");
loadEnvLocal();
const BASE = process.env.BASE_URL ?? "http://localhost:3109";
const EMAIL = process.env.E2E_EMAIL ?? "staff@example.test";
const PASSWORD = process.env.E2E_PASSWORD ?? "password";
let up = false;
try {
  await fetch(`${BASE}/login`, { signal: AbortSignal.timeout(5000) });
  up = true;
} catch {}
const skip = up ? false : `no app at ${BASE}`;
console.log(up ? `[shell-wiring] HTTP check RUN against ${BASE}` : `[shell-wiring] HTTP check SKIPPED: no app at ${BASE}`);

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

test("HTTP: signed-in staff home has header link to /inquiries and both search forms", { skip, timeout: 180_000 }, async () => {
  const { chromium } = await import("@playwright/test");
  const { createServerClient } = await import("../../lib/db/client.ts");
  await retry(() => seedE2eUser(createServerClient(), EMAIL, PASSWORD));
  const browser = await chromium.launch();
  try {
    const p = await (await browser.newContext()).newPage();
    await retry(async () => {
      await p.goto(`${BASE}/login`);
      await p.getByLabel(/email/i).fill(EMAIL);
      await p.getByLabel(/password/i).fill(PASSWORD);
      await p.getByRole("button", { name: /sign in/i }).click();
      await p.waitForURL((u) => u.pathname !== "/login", { timeout: 20_000 }).catch(async () => {
        throw new Error(`login stuck (429?): ${await p.locator("body").innerText()}`);
      });
    });
    await p.goto(`${BASE}/`);
    assert.ok((await p.locator('header a[href="/inquiries"]').count()) >= 1, "header lacks /inquiries");
    assert.equal(await p.locator('form[action="/cases"] input[name="q"]').count(), 1, "case box");
    assert.equal(await p.locator('form[action="/inquiries"] input[name="q"]').count(), 1, "inquiry box");
  } finally {
    await browser.close();
  }
});
