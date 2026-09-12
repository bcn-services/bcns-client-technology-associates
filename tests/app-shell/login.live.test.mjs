/**
 * Live check of /login and /signout against a running app driven through the real form.
 * Needs: `pnpm dev` (or `pnpm start`) on BASE_URL (default http://localhost:3100) and the
 * seeded account (`pnpm exec tsx tests/app-shell/seed-e2e.ts`). Skips when no server answers.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { chromium } from "@playwright/test";

const BASE = process.env.BASE_URL ?? "http://localhost:3100";
const EMAIL = process.env.E2E_EMAIL ?? "staff@example.test";
const PASSWORD = process.env.E2E_PASSWORD ?? "password";
const WRONG = "definitely-not-the-password-7f3a";

let up = false;
try {
  await fetch(`${BASE}/api/health`, { signal: AbortSignal.timeout(3000) });
  up = true;
} catch {}
const skip = up ? false : `no app at ${BASE}`;

let browser;
before(async () => { if (up) browser = await chromium.launch(); });
after(async () => { await browser?.close(); });

const isAuthCookie = (c) => /^sb-.*-auth-token(\.\d+)?$/.test(c.name) && c.value !== "";
const authCookies = async (ctx) => (await ctx.cookies()).filter(isAuthCookie);

async function submit(page, next, password) {
  await page.goto(`${BASE}/login${next === undefined ? "" : `?next=${encodeURIComponent(next)}`}`);
  await page.getByLabel(/email/i).fill(EMAIL);
  await page.getByLabel(/password/i).fill(password);
  await Promise.all([
    page.waitForURL((u) => u.pathname !== "/login" || u.searchParams.has("error")),
    page.getByRole("button", { name: /sign in/i }).click(),
  ]);
}

test("correct credentials land on ?next= path with a session cookie", { skip }, async () => {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await submit(page, "/foo?a=1", PASSWORD);
  const url = new URL(page.url());
  assert.equal(url.origin + url.pathname + url.search, `${BASE}/foo?a=1`);
  assert.ok((await authCookies(ctx)).length > 0, "no sb-*-auth-token cookie set");
  await ctx.close();
});

for (const next of ["https://example.com", "//example.com", "/\\example.com"]) {
  test(`next=${next} falls back to /`, { skip }, async () => {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await submit(page, next, PASSWORD);
    assert.equal(page.url(), `${BASE}/`);
    await ctx.close();
  });
}

test("wrong password re-renders login with an error and sets no session", { skip }, async () => {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await submit(page, "/foo", WRONG);
  assert.equal(new URL(page.url()).pathname, "/login");
  // By text, not role: Next's route announcer is also role="alert".
  assert.ok(await page.getByText(/invalid email or password/i).isVisible(), "no visible error");
  assert.ok(!page.url().includes(WRONG) && !(await page.content()).includes(WRONG), "password echoed");
  assert.deepEqual(await authCookies(ctx), []);
  await ctx.close();
});

test("POST /signout clears the session; a gated path then redirects to /login", { skip }, async () => {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await submit(page, "/cases", PASSWORD);
  assert.ok((await authCookies(ctx)).length > 0);

  // Signed in, the gated route is reachable (no redirect to /login).
  const pre = await ctx.request.get(`${BASE}/cases`, { maxRedirects: 0 });
  assert.notEqual(pre.status(), 307);

  const out = await ctx.request.post(`${BASE}/signout`, { maxRedirects: 0 });
  assert.equal(out.status(), 303);
  assert.equal(new URL(out.headers().location, BASE).pathname, "/login");
  assert.deepEqual(await authCookies(ctx), [], "auth cookies survived signout");

  const gated = await ctx.request.get(`${BASE}/cases`, { maxRedirects: 0 });
  assert.equal(gated.status(), 307);
  assert.equal(new URL(gated.headers().location, BASE).pathname, "/login");
  await ctx.close();
});
