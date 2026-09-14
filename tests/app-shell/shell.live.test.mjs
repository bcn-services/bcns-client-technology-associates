/**
 * Live check of the app shell (header nav, role-gated Users link, in-shell not-found).
 * Needs: `pnpm dev` on BASE_URL (default http://localhost:3100) and .env.local with the
 * service-role key. Seeds the staff account and a throwaway admin itself; the admin is deleted after.
 * Skips when no server answers.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { chromium } from "@playwright/test";
import { loadEnvLocal, seedE2eUser } from "./seed-e2e.ts";
import { createServerClient } from "../../lib/db/client.ts";

const BASE = process.env.BASE_URL ?? "http://localhost:3100";
const STAFF_EMAIL = process.env.E2E_EMAIL ?? "staff@example.test";
const STAFF_PASSWORD = process.env.E2E_PASSWORD ?? "password";
const ADMIN_EMAIL = `shell-admin-${randomUUID().slice(0, 8)}@example.test`;
const ADMIN_PASSWORD = `pw-${randomUUID()}`;
const SECTIONS = ["/cases", "/time", "/bills", "/expenses", "/funds", "/bank-review", "/documents", "/reports", "/dashboard"];

let up = false;
try {
  await fetch(`${BASE}/api/health`, { signal: AbortSignal.timeout(3000) });
  up = true;
} catch {}
const skip = up ? false : `no app at ${BASE}`;

let browser, admin, adminId;
before(async () => {
  if (!up) return;
  loadEnvLocal();
  admin = createServerClient();
  await seedE2eUser(admin, STAFF_EMAIL, STAFF_PASSWORD);
  adminId = (await seedE2eUser(admin, ADMIN_EMAIL, ADMIN_PASSWORD)).id;
  const { error } = await admin.from("profiles").update({ role: "admin" }).eq("id", adminId);
  if (error) throw new Error(error.message);
  browser = await chromium.launch();
});
after(async () => {
  await browser?.close();
  if (adminId) {
    await admin.from("profiles").delete().eq("id", adminId);
    await admin.auth.admin.deleteUser(adminId);
  }
});

/** Sign in through the real form; returns a browser context holding the session cookie. */
async function signIn(email, password) {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.goto(`${BASE}/login`);
  await page.getByLabel(/email/i).fill(email);
  await page.getByLabel(/password/i).fill(password);
  await Promise.all([
    page.waitForURL((u) => u.pathname !== "/login"),
    page.getByRole("button", { name: /sign in/i }).click(),
  ]);
  return { ctx, page };
}

const hasHref = (html, href) => html.includes(`href="${href}"`);

function assertShell(html, email, role) {
  assert.ok(html.includes(email), "email missing from header");
  assert.match(html, new RegExp(`>${role}<`), `role ${role} missing from header`);
  for (const href of [...SECTIONS, "/account"]) assert.ok(hasHref(html, href), `nav link ${href} missing`);
  assert.ok(html.includes('action="/signout"'), "sign-out form missing");
}

test("staff: header shows email, role, nine sections + /account; /users absent from raw HTML", { skip }, async () => {
  const { ctx } = await signIn(STAFF_EMAIL, STAFF_PASSWORD);
  const res = await ctx.request.get(`${BASE}/`);
  assert.equal(res.status(), 200);
  const html = await res.text();
  assertShell(html, STAFF_EMAIL, "staff");
  // Raw document incl. RSC flight payload — hidden-by-CSS would still fail this.
  assert.ok(!html.includes("/users"), "/users leaked into staff markup");
  await ctx.close();
});

test("admin: same header plus a link to /users", { skip }, async () => {
  const { ctx } = await signIn(ADMIN_EMAIL, ADMIN_PASSWORD);
  const html = await (await ctx.request.get(`${BASE}/`)).text();
  assertShell(html, ADMIN_EMAIL, "admin");
  assert.ok(hasHref(html, "/users"), "admin header lacks /users");
  await ctx.close();
});

// A path no lane will build, so later lanes shipping a section can't turn this stale.
const MISSING = "/no-such-section";

test("signed-in GET of a missing path → 404 rendered inside the shell with a usable nav", { skip }, async () => {
  const { ctx, page } = await signIn(STAFF_EMAIL, STAFF_PASSWORD);
  const res = await ctx.request.get(`${BASE}${MISSING}`);
  assert.equal(res.status(), 404);
  const html = await res.text();
  assertShell(html, STAFF_EMAIL, "staff");
  assert.ok(html.includes("Not built yet"), "custom not-found message missing");
  assert.ok(!html.includes("This page could not be found"), "Next default 404 rendered");

  // Nav is usable: clicking a section link from the 404 navigates there.
  await page.goto(`${BASE}${MISSING}`);
  await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Time" }).click();
  await page.waitForURL(`${BASE}/time`);
  await page.getByRole("heading", { name: "Not built yet" }).waitFor({ state: "detached" });
  await ctx.close();
});

test("no session: /login renders with no nav, no identity, no sign-out", { skip }, async () => {
  const res = await fetch(`${BASE}/login`);
  assert.equal(res.status, 200);
  const html = await res.text();
  assert.ok(html.includes("Sign in"), "login page did not render");
  for (const href of [...SECTIONS, "/account", "/users"]) assert.ok(!hasHref(html, href), `nav link ${href} rendered with no session`);
  assert.ok(!html.includes('action="/signout"'), "sign-out rendered with no session");
  assert.ok(!html.includes(STAFF_EMAIL), "identity rendered with no session");
});
