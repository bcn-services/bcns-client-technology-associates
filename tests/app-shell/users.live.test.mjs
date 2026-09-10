/**
 * Live check of /users (LANE item 5): admin gate on page + server action, create →
 * sign in with the displayed temp password, password shown exactly once.
 * Needs `pnpm dev` on BASE_URL and .env.local. Skips when no server answers.
 * Every account it creates is an invented @example.test address and is deleted after.
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
const tag = randomUUID().slice(0, 8);
const ADMIN_EMAIL = `users-admin-${tag}@example.test`;
const ADMIN_PASSWORD = `pw-${randomUUID()}`;
const NEW_EMAIL = `users-new-${tag}@example.test`;
const REPLAY_EMAIL = `users-replay-${tag}@example.test`;
const STAFF_REPLAY_EMAIL = `users-staffpost-${tag}@example.test`;
const CREATED = [NEW_EMAIL, REPLAY_EMAIL, STAFF_REPLAY_EMAIL];

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

// ponytail: scans all auth users; fine for the test project.
async function authUserId(email) {
  for (let page = 1; ; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw new Error(error.message);
    const hit = data.users.find((u) => u.email === email);
    if (hit) return hit.id;
    if (data.users.length < 1000) return null;
  }
}

after(async () => {
  await browser?.close();
  if (!admin) return;
  for (const email of CREATED) {
    await admin.from("profiles").delete().eq("email", email);
    const id = await authUserId(email);
    if (id) await admin.auth.admin.deleteUser(id);
  }
  if (adminId) {
    await admin.from("profiles").delete().eq("id", adminId);
    await admin.auth.admin.deleteUser(adminId);
  }
});

async function signIn(email, password) {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.goto(`${BASE}/login`);
  await page.getByLabel(/email/i).fill(email);
  await page.getByLabel(/password/i).fill(password);
  await Promise.all([page.waitForURL((u) => u.pathname !== "/login"), page.getByRole("button", { name: /sign in/i }).click()]);
  return { ctx, page };
}

/** Supabase password grant — succeeds only for a confirmed account with that password. */
async function passwordGrant(email, password) {
  const res = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, "content-type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  return { status: res.status, body: await res.json() };
}

let captured; // the admin's create-action request, replayed below

test("staff GET /users is refused: no list, no create form, no other profiles' emails", { skip }, async () => {
  const { ctx } = await signIn(STAFF_EMAIL, STAFF_PASSWORD);
  const res = await ctx.request.get(`${BASE}/users`);
  const html = await res.text();
  assert.notEqual(res.status(), 200, "staff got a 200 for /users");
  assert.ok(!html.includes(ADMIN_EMAIL), "another profile's email leaked to staff");
  assert.ok(!html.includes("New user email"), "create form rendered for staff");
  await ctx.close();
});

test("admin GET /users renders the list with email and role", { skip }, async () => {
  const { ctx } = await signIn(ADMIN_EMAIL, ADMIN_PASSWORD);
  const res = await ctx.request.get(`${BASE}/users`);
  assert.equal(res.status(), 200);
  const html = await res.text();
  assert.ok(html.includes(ADMIN_EMAIL) && html.includes(STAFF_EMAIL), "list missing profiles");
  assert.ok(html.includes("New user email"), "create form missing");
  await ctx.close();
});

test("admin creates a user; temp password shown once, signs in with no confirm step, gone after reload", { skip }, async () => {
  const { ctx, page } = await signIn(ADMIN_EMAIL, ADMIN_PASSWORD);
  await page.goto(`${BASE}/users`);
  page.on("request", (r) => { if (r.headers()["next-action"]) captured = { headers: r.headers(), body: r.postDataBuffer() }; });
  await page.getByLabel("New user email").fill(NEW_EMAIL);
  await page.getByRole("button", { name: "Create user" }).click();
  const password = (await page.getByTestId("temp-password").textContent()).trim();
  assert.match(password, /^[A-Za-z0-9_-]{24}$/);
  assert.ok(!page.url().includes(password), "password in URL");

  // Auth user + profiles row, no password stored anywhere in the row.
  const { data: prof } = await admin.from("profiles").select("*").eq("email", NEW_EMAIL).single();
  assert.equal(prof.role, "staff");
  assert.ok(!JSON.stringify(prof).includes(password), "password stored in profiles");
  assert.ok(!Object.keys(prof).some((k) => /pass/i.test(k)), "password column in profiles");
  assert.equal(await authUserId(NEW_EMAIL), prof.id);

  const grant = await passwordGrant(NEW_EMAIL, password);
  assert.equal(grant.status, 200, `sign-in failed: ${JSON.stringify(grant.body)}`);
  assert.ok(grant.body.access_token);

  // Exactly once: a fresh GET and a reload carry neither the password nor its box.
  const fresh = await (await ctx.request.get(`${BASE}/users`)).text();
  assert.ok(fresh.includes(NEW_EMAIL), "new user not in list");
  assert.ok(!fresh.includes(password), "password in fresh GET /users");
  await page.reload();
  assert.ok(!(await page.content()).includes(password), "password survived reload");
  assert.equal(await page.getByTestId("temp-password").count(), 0);

  // Duplicate: visible error, existing account's password untouched.
  await page.getByLabel("New user email").fill(NEW_EMAIL);
  await page.getByRole("button", { name: "Create user" }).click();
  await page.getByText(/already exists/).waitFor();
  assert.equal((await passwordGrant(NEW_EMAIL, password)).status, 200, "duplicate create changed the password");
  await ctx.close();
});

function replay(ctx, email) {
  const headers = { ...captured.headers };
  for (const h of ["cookie", "content-length", "host"]) delete headers[h];
  const data = Buffer.from(captured.body.toString("latin1").replaceAll(NEW_EMAIL, email), "latin1");
  return ctx.request.post(`${BASE}/users`, { headers, data });
}

test("staff POSTing the create action is refused and creates nothing (control: admin replay creates)", { skip }, async () => {
  assert.ok(captured, "no action request captured");
  const adminCtx = (await signIn(ADMIN_EMAIL, ADMIN_PASSWORD)).ctx;
  await replay(adminCtx, REPLAY_EMAIL);
  assert.ok(await authUserId(REPLAY_EMAIL), "control replay did not create — replay mechanism broken");
  await adminCtx.close();

  const { ctx } = await signIn(STAFF_EMAIL, STAFF_PASSWORD);
  const res = await replay(ctx, STAFF_REPLAY_EMAIL);
  assert.ok(!(await res.text()).includes("temp-password"));
  assert.equal(await authUserId(STAFF_REPLAY_EMAIL), null, "staff created an auth user");
  const { data } = await admin.from("profiles").select("id").eq("email", STAFF_REPLAY_EMAIL);
  assert.equal(data.length, 0, "staff created a profiles row");
  await ctx.close();
});
