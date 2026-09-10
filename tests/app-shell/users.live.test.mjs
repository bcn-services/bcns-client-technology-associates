/**
 * Live check of /users (LANE item 5): admin gate on page + server action, create →
 * sign in with the displayed temp password, password shown exactly once.
 * Needs `pnpm dev` on BASE_URL and .env.local. Skips when no server answers.
 * Every account it creates is an invented @example.test address and is deleted after.
 * Item 6 (below): role change, billing person, deactivate — UI flows + staff-cookie replays.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { chromium } from "@playwright/test";
import { loadEnvLocal, seedE2eUser } from "./seed-e2e.ts";
import { createServerClient } from "../../lib/db/client.ts";
import { createClient } from "@supabase/supabase-js";
import { getSession } from "../../lib/auth/session.ts";

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
  // Polish: a clean refusal page, not a 500.
  assert.equal(res.status(), 200, "staff /users refusal should be a page, not an error");
  assert.match(html, /Admins only\./, "no refusal message for staff");
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
  const body = await res.text();
  assert.ok(!body.includes("temp-password"));
  assert.equal(res.status(), 200, "staff create replay should be a clean refusal, not a 500");
  assert.match(body, /Admins only\./, "staff create replay body");
  assert.equal(await authUserId(STAFF_REPLAY_EMAIL), null, "staff created an auth user");
  const { data } = await admin.from("profiles").select("id").eq("email", STAFF_REPLAY_EMAIL);
  assert.equal(data.length, 0, "staff created a profiles row");
  await ctx.close();
});

// ---------------------------------------------------------------------------
// LANE item 6 — role, billing person, deactivation.
// ---------------------------------------------------------------------------
const B_EMAIL = `users-b-${tag}@example.test`;
const B_PASSWORD = `pw-${randomUUID()}`;
const C_EMAIL = `users-c-${tag}@example.test`;
let bId, cId, pid; // pid: a throwaway tblbillingnames row (no migration; deleted after)

before(async () => {
  if (!up) return;
  bId = (await seedE2eUser(admin, B_EMAIL, B_PASSWORD)).id;
  cId = (await seedE2eUser(admin, C_EMAIL, `pw-${randomUUID()}`)).id;
  const { data, error } = await admin.from("tblbillingnames").insert({ initials: `Z${tag.slice(0, 3)}`, billingfactor: 1 }).select("personid").single();
  if (error) throw new Error(`seed tblbillingnames: ${error.message}`);
  pid = data.personid;
});

after(async () => {
  if (!admin) return;
  for (const id of [bId, cId]) {
    if (!id) continue;
    await admin.from("profiles").delete().eq("id", id);
    await admin.auth.admin.deleteUser(id);
  }
  if (pid != null) await admin.from("tblbillingnames").delete().eq("personid", pid);
});

const prof = async (id) => (await admin.from("profiles").select("*").eq("id", id).maybeSingle()).data;
const row = (page, id) => page.locator(`tr[data-user-id="${id}"]`);
const outcome = (page, label, re) => page.getByRole("status", { name: label }).filter({ hasText: re }).waitFor();

/** Signed-in /users page; accepts the deactivate confirm; remembers the last server-action request. */
async function usersPage(email, password) {
  const s = await signIn(email, password);
  s.page.on("dialog", (d) => d.accept());
  s.page.on("request", (r) => { if (r.headers()["next-action"]) s.last = { headers: r.headers(), body: r.postDataBuffer() }; });
  await s.page.goto(`${BASE}/users`);
  return s;
}

/** getSession() through a real user-scoped client signed in with a password. */
async function sessionFor(email, password) {
  const c = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  const { error } = await c.auth.signInWithPassword({ email, password });
  if (error) throw new Error(error.message);
  return getSession(c);
}

test("item6: admin deactivating themselves is refused with a visible message; row kept", { skip }, async () => {
  const s = await usersPage(ADMIN_EMAIL, ADMIN_PASSWORD);
  await row(s.page, adminId).getByRole("button", { name: "Deactivate" }).click();
  await outcome(s.page, `Deactivate result for ${ADMIN_EMAIL}`, /own account/);
  assert.ok(await prof(adminId), "own profiles row was deleted");
  await s.ctx.close();
});

test("item6: billing dropdown writes personid and getSession returns it; none stores null", { skip }, async () => {
  const s = await usersPage(ADMIN_EMAIL, ADMIN_PASSWORD);
  const r = row(s.page, bId);
  await r.getByLabel(`Billing person for ${B_EMAIL}`).selectOption(String(pid));
  await r.getByRole("button", { name: "Save billing person" }).click();
  await outcome(s.page, `Billing person result for ${B_EMAIL}`, /set\./);
  assert.equal((await prof(bId)).personid, pid);
  assert.equal((await sessionFor(B_EMAIL, B_PASSWORD)).personId, pid);

  await r.getByLabel(`Billing person for ${B_EMAIL}`).selectOption("");
  await r.getByRole("button", { name: "Save billing person" }).click();
  await outcome(s.page, `Billing person result for ${B_EMAIL}`, /cleared/);
  assert.equal((await prof(bId)).personid, null);
  assert.equal((await sessionFor(B_EMAIL, B_PASSWORD)).personId, null);
  await s.ctx.close();
});

test("item6: sole admin can't be removed; after promoting B, B deactivates A; re-inserting A's row restores A's sign-in", { skip }, async (t) => {
  const { count } = await admin.from("profiles").select("id", { count: "exact", head: true }).eq("role", "admin");
  if (count !== 1) return t.skip(`needs exactly one admin in the shared project, found ${count}`);

  // With one admin the only possible actor is that admin, so the reachable "remove the
  // last admin" paths are self-deactivation (test above) and demotion (here).
  const a = await usersPage(ADMIN_EMAIL, ADMIN_PASSWORD);
  await row(a.page, adminId).getByLabel(`Role for ${ADMIN_EMAIL}`).selectOption("staff");
  await row(a.page, adminId).getByRole("button", { name: "Save role" }).click();
  await outcome(a.page, `Role result for ${ADMIN_EMAIL}`, /last remaining admin/);
  assert.equal((await prof(adminId)).role, "admin");

  await row(a.page, bId).getByLabel(`Role for ${B_EMAIL}`).selectOption("admin");
  await row(a.page, bId).getByRole("button", { name: "Save role" }).click();
  await outcome(a.page, `Role result for ${B_EMAIL}`, /now admin/);
  assert.equal((await prof(bId)).role, "admin");

  const saved = await prof(adminId);
  const b = await usersPage(B_EMAIL, B_PASSWORD);
  await row(b.page, adminId).getByRole("button", { name: "Deactivate" }).click();
  await row(b.page, adminId).waitFor({ state: "detached" });
  assert.equal(await prof(adminId), null, "profiles row not deleted");
  assert.equal(await authUserId(ADMIN_EMAIL), adminId, "auth user was deleted — deactivation must be reversible");
  const dead = await a.ctx.request.get(`${BASE}/users`, { maxRedirects: 0 });
  assert.notEqual(dead.status(), 200, "deactivated admin still reaches /users");

  const { error } = await admin.from("profiles").insert(saved);
  assert.ifError(error);
  const again = await signIn(ADMIN_EMAIL, ADMIN_PASSWORD);
  assert.equal((await again.ctx.request.get(`${BASE}/users`)).status(), 200, "re-created row did not restore sign-in");
  for (const x of [a, b, again]) await x.ctx.close();
});

function replayOn(ctx, cap, fromId, toId) {
  const headers = { ...cap.headers };
  for (const h of ["cookie", "content-length", "host"]) delete headers[h];
  const body = cap.body.toString("latin1");
  assert.ok(body.includes(fromId), "captured action body lacks the target id");
  return ctx.request.post(`${BASE}/users`, { headers, data: Buffer.from(body.replaceAll(fromId, toId), "latin1") });
}

test("item6: staff POSTing role/billing/deactivate actions changes nothing (control: admin replay applies)", { skip }, async () => {
  const a = await usersPage(ADMIN_EMAIL, ADMIN_PASSWORD);
  const r = row(a.page, bId);
  const cap = {};
  await r.getByLabel(`Role for ${B_EMAIL}`).selectOption("admin");
  await r.getByRole("button", { name: "Save role" }).click();
  await outcome(a.page, `Role result for ${B_EMAIL}`, /admin/);
  cap.role = a.last;
  await r.getByLabel(`Billing person for ${B_EMAIL}`).selectOption(String(pid));
  await r.getByRole("button", { name: "Save billing person" }).click();
  await outcome(a.page, `Billing person result for ${B_EMAIL}`, /set\./);
  cap.billing = a.last;
  await r.getByRole("button", { name: "Deactivate" }).click();
  await r.waitFor({ state: "detached" });
  cap.deactivate = a.last;

  const staff = await signIn(STAFF_EMAIL, STAFF_PASSWORD);
  for (const k of ["role", "billing", "deactivate"]) {
    const res = await replayOn(staff.ctx, cap[k], bId, cId);
    // qa: a staff replay is a clean refusal, not a 500.
    assert.equal(res.status(), 200, `staff ${k} replay status`);
    assert.match(await res.text(), /Admins only\./, `staff ${k} replay body`);
  }
  const c = await prof(cId);
  assert.ok(c, "staff replay deactivated C");
  assert.equal(c.role, "staff", "staff replay changed a role");
  assert.equal(c.personid, null, "staff replay set a billing person");

  await replayOn(a.ctx, cap.role, bId, cId);
  assert.equal((await prof(cId)).role, "admin", "control role replay did nothing — replay mechanism broken");
  await replayOn(a.ctx, cap.billing, bId, cId);
  assert.equal((await prof(cId)).personid, pid, "control billing replay did nothing");
  await replayOn(a.ctx, cap.deactivate, bId, cId);
  assert.equal(await prof(cId), null, "control deactivate replay did nothing");
  assert.equal(await authUserId(C_EMAIL), cId, "deactivate deleted the auth user");
  await staff.ctx.close();
  await a.ctx.close();
});

// ---------------------------------------------------------------------------
// Polish — a deactivated account is told why at sign-in, and an admin can reactivate it.
// ---------------------------------------------------------------------------
const D_EMAIL = `users-d-${tag}@example.test`;
const D_PASSWORD = `pw-${randomUUID()}`;
let dId;

after(async () => {
  if (!admin || !dId) return;
  await admin.from("profiles").delete().eq("id", dId);
  await admin.auth.admin.deleteUser(dId);
});

const isAuthCookie = (c) => /^sb-.*-auth-token(\.\d+)?$/.test(c.name) && c.value !== "";

test("polish: deactivated account sees a message and keeps no session; admin re-create reactivates it with the old password", { skip }, async () => {
  dId = (await seedE2eUser(admin, D_EMAIL, D_PASSWORD)).id;
  await admin.from("profiles").delete().eq("id", dId); // deactivate, as deactivateUser does

  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.goto(`${BASE}/login`);
  await page.getByLabel(/email/i).fill(D_EMAIL);
  await page.getByLabel(/password/i).fill(D_PASSWORD);
  await Promise.all([page.waitForURL((u) => u.searchParams.has("error") || u.pathname !== "/login"), page.getByRole("button", { name: /sign in/i }).click()]);
  assert.equal(new URL(page.url()).searchParams.get("error"), "deactivated");
  assert.ok(await page.getByText(/deactivated — ask an admin/i).isVisible(), "no deactivated message");
  assert.deepEqual((await ctx.cookies()).filter(isAuthCookie), [], "deactivated sign-in kept a session cookie");
  await ctx.close();

  const s = await usersPage(ADMIN_EMAIL, ADMIN_PASSWORD);
  await s.page.getByLabel("New user email").fill(D_EMAIL);
  await s.page.getByRole("button", { name: "Create user" }).click();
  await s.page.getByText(/Reactivated/).waitFor();
  assert.equal(await s.page.getByTestId("temp-password").count(), 0, "reactivation showed a new password");
  assert.equal((await prof(dId))?.role, "staff", "profiles row not restored");
  await s.ctx.close();

  assert.equal((await passwordGrant(D_EMAIL, D_PASSWORD)).status, 200, "reactivation changed the password");
  const back = await signIn(D_EMAIL, D_PASSWORD);
  assert.equal(new URL(back.page.url()).pathname, "/", "reactivated account did not reach the app");
  await back.ctx.close();
});
