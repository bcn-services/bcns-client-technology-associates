/**
 * Live check of /account (LANE item 7): a signed-in user changes their OWN password,
 * re-authenticating with the current one first. Needs `pnpm dev` on BASE_URL and .env.local.
 * Skips when no server answers. Uses only throwaway @example.test accounts, deleted after —
 * never staff@example.test.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { setTimeout as sleep } from "node:timers/promises";
import { chromium } from "@playwright/test";
import { loadEnvLocal, seedE2eUser } from "./seed-e2e.ts";
import { createServerClient } from "../../lib/db/client.ts";

const BASE = process.env.BASE_URL ?? "http://localhost:3100";
const tag = randomUUID().slice(0, 8);
const USER_EMAIL = `account-self-${tag}@example.test`;
const OTHER_EMAIL = `account-other-${tag}@example.test`;
const pw = (label) => `${label}-${randomUUID()}`;
const USER_PW = pw("orig");
const OTHER_PW = pw("other");
const SECRETS = [USER_PW, OTHER_PW]; // every password string used, checked against every response

let up = false;
try {
  await fetch(`${BASE}/api/health`, { signal: AbortSignal.timeout(3000) });
  up = true;
} catch {}
const skip = up ? false : `no app at ${BASE}`;

let browser, admin;
const ids = [];
before(async () => {
  if (!up) return;
  loadEnvLocal();
  admin = createServerClient();
  ids.push((await seedE2eUser(admin, USER_EMAIL, USER_PW)).id);
  ids.push((await seedE2eUser(admin, OTHER_EMAIL, OTHER_PW)).id);
  browser = await chromium.launch();
});

after(async () => {
  await browser?.close();
  for (const id of ids) {
    await admin.from("profiles").delete().eq("id", id);
    await admin.auth.admin.deleteUser(id);
  }
});

/**
 * Supabase password grant on a fresh session — 200 only if the password is current.
 * A 429 (shared-project rate limit) says nothing about the password, so it is retried.
 */
async function grant(email, password) {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/auth/v1/token?grant_type=password`, {
      method: "POST",
      headers: { apikey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, "content-type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    await res.arrayBuffer();
    if (res.status !== 429 || attempt >= 6) return res.status;
    await sleep(Math.min(Number(res.headers.get("retry-after")) * 1000 || 2000 * 2 ** attempt, 15000));
  }
}

/** Signed-in page on /account that records every server-action request and response. */
async function openAccount(email, password) {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  // /login reports a shared-project 429 as error=invalid, so a bounced sign-in is retried with backoff.
  for (let attempt = 0; ; attempt++) {
    await page.goto(`${BASE}/login`);
    await page.getByLabel(/email/i).fill(email);
    await page.getByLabel(/password/i).fill(password);
    await Promise.all([
      page.waitForURL((u) => u.pathname !== "/login" || u.searchParams.has("error")),
      page.getByRole("button", { name: /sign in/i }).click(),
    ]);
    if (new URL(page.url()).pathname !== "/login") break;
    assert.ok(attempt < 5, `sign-in kept bouncing: ${new URL(page.url()).search}`);
    await sleep(3000 * 2 ** attempt);
  }
  await page.goto(`${BASE}/account`);
  const seen = { requests: [], responses: [] };
  page.on("request", (r) => { if (r.headers()["next-action"]) seen.requests.push({ headers: r.headers(), body: r.postDataBuffer() }); });
  page.on("response", async (r) => {
    if (!r.request().headers()["next-action"]) return;
    seen.responses.push({ status: r.status(), headers: r.headers(), body: await r.text().catch(() => "") });
  });
  return { ctx, page, seen };
}

async function submit(page, current, next, confirm) {
  await page.getByLabel("Current password").fill(current);
  await page.getByLabel("New password", { exact: true }).fill(next);
  await page.getByLabel("Confirm new password").fill(confirm);
  await page.getByRole("button", { name: "Change password" }).click();
}

function assertNoSecrets(where, text) {
  for (const s of SECRETS) assert.ok(!String(text).includes(s), `a password appeared in ${where}`);
}

async function assertNoSecretsSeen(page, seen) {
  assert.ok(seen.responses.length > 0, "no server-action response captured");
  for (const r of seen.responses) {
    assertNoSecrets("action response body", r.body);
    assertNoSecrets("action response headers", JSON.stringify(r.headers));
  }
  assertNoSecrets("page URL", page.url());
  assertNoSecrets("page HTML", await page.content());
}

async function assertStillSignedIn(ctx) {
  const res = await ctx.request.get(`${BASE}/account`, { maxRedirects: 0 });
  assert.equal(res.status(), 200, `GET /account → ${res.status()} ${res.headers().location ?? ""}`);
}

test("page renders only the three password fields — no email or user-id input", { skip }, async () => {
  const { ctx, page } = await openAccount(USER_EMAIL, USER_PW);
  assert.equal(await page.getByLabel("Current password").getAttribute("type"), "password");
  assert.equal(await page.getByLabel("New password", { exact: true }).getAttribute("type"), "password");
  assert.equal(await page.getByLabel("Confirm new password").getAttribute("type"), "password");
  const form = page.getByRole("region", { name: "Change password" });
  const names = await form.locator("input:not([type=hidden])").evaluateAll((els) => els.map((e) => e.name));
  assert.deepEqual(names.sort(), ["confirm", "current", "new"]);
  assert.equal(await page.locator("input[name*=email i], input[name*=user i], input[name=id]").count(), 0);
  await ctx.close();
});

test("wrong current password is refused visibly; password unchanged; still signed in", { skip }, async () => {
  const { ctx, page, seen } = await openAccount(USER_EMAIL, USER_PW);
  const wrong = pw("wrong"), next = pw("next");
  SECRETS.push(wrong, next);
  await submit(page, wrong, next, next);
  await page.getByText("Current password is incorrect.").waitFor();
  assert.equal(await grant(USER_EMAIL, USER_PW), 200, "old password stopped working");
  assert.equal(await grant(USER_EMAIL, next), 400, "password changed despite wrong current password");
  await assertNoSecretsSeen(page, seen);
  await assertStillSignedIn(ctx);
  await ctx.close();
});

test("new/confirm mismatch is refused visibly; password unchanged", { skip }, async () => {
  const { ctx, page, seen } = await openAccount(USER_EMAIL, USER_PW);
  const next = pw("next"), other = pw("confirm");
  SECRETS.push(next, other);
  await submit(page, USER_PW, next, other);
  await page.getByText("New password and confirmation do not match.").waitFor();
  assert.equal(await grant(USER_EMAIL, USER_PW), 200, "old password stopped working");
  assert.equal(await grant(USER_EMAIL, next), 400, "password changed despite mismatch");
  assert.equal(await grant(USER_EMAIL, other), 400, "password changed to the confirm value");
  await assertNoSecretsSeen(page, seen);
  await assertStillSignedIn(ctx);
  await ctx.close();
});

test("crafted POST naming another account is ignored: target and self both unchanged", { skip }, async () => {
  // Capture a genuine action request (a mismatch, so nothing changes), then replay it with
  // the other account's email injected and the other account's real password as "current".
  const { ctx, page, seen } = await openAccount(USER_EMAIL, USER_PW);
  const a = pw("a"), b = pw("b"), target = pw("target");
  SECRETS.push(a, b, target);
  await submit(page, USER_PW, a, b);
  await page.getByText("New password and confirmation do not match.").waitFor();
  const captured = seen.requests.at(-1);
  assert.ok(captured, "no action request captured");

  // Raw rewrite of the genuine body: swap the password values, append id-bearing parts
  // under the same field prefix the real fields use (e.g. "1_current" → "1_email").
  const boundary = /boundary=(.+)$/.exec(captured.headers["content-type"])?.[1];
  assert.ok(boundary, `action body is not multipart: ${captured.headers["content-type"]}`);
  let raw = captured.body.toString("latin1");
  const prefix = /name="([^"]*)current"/.exec(raw)?.[1];
  assert.ok(prefix !== undefined, "no current-password field in the action body");
  raw = raw.replaceAll(USER_PW, OTHER_PW).replaceAll(a, target).replaceAll(b, target);
  const extra = { email: OTHER_EMAIL, userId: ids[1], user_id: ids[1], id: ids[1] };
  const parts = Object.entries(extra).map(([k, v]) => `--${boundary}\r\nContent-Disposition: form-data; name="${prefix}${k}"\r\n\r\n${v}\r\n`).join("");
  // Inject before the real fields: Next resolves the FormData when the trailing "0" part arrives,
  // so parts appended at the end never reach the action.
  const anchor = `--${boundary}\r\nContent-Disposition: form-data; name="${prefix}current"`;
  raw = raw.replace(anchor, `${parts}${anchor}`);
  assert.ok(raw.includes(`name="${prefix}email"`), "id-bearing fields were not injected into the replay");

  const headers = { ...captured.headers };
  for (const h of ["cookie", "content-length", "host"]) delete headers[h];
  const res = await ctx.request.post(`${BASE}/account`, { headers, data: Buffer.from(raw, "latin1"), maxRedirects: 0 });
  const body = await res.text();
  assert.ok(body.includes("Current password is incorrect."), `crafted POST not refused (status ${res.status()})`);
  assertNoSecrets("crafted response body", body);
  assertNoSecrets("crafted response headers", JSON.stringify(res.headers()));

  assert.equal(await grant(OTHER_EMAIL, OTHER_PW), 200, "other account's password changed");
  assert.equal(await grant(OTHER_EMAIL, target), 400, "other account's password changed");
  assert.equal(await grant(USER_EMAIL, USER_PW), 200, "own password changed");
  assert.equal(await grant(USER_EMAIL, target), 400, "own password changed");
  await ctx.close();
});

test("correct current + matching new succeeds: new signs in fresh, old rejected, still signed in", { skip }, async () => {
  const { ctx, page, seen } = await openAccount(USER_EMAIL, USER_PW);
  const next = pw("new");
  SECRETS.push(next);
  await submit(page, USER_PW, next, next);
  await page.getByText("Password changed.").waitFor();
  assert.equal(await grant(USER_EMAIL, next), 200, "new password does not sign in");
  assert.equal(await grant(USER_EMAIL, USER_PW), 400, "old password still signs in");
  await assertNoSecretsSeen(page, seen);
  await assertStillSignedIn(ctx);
  await ctx.close();
});
