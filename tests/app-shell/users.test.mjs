/** Unit checks for lib/auth/users.ts — injected fake admin client, no network. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { generateTempPassword, createStaffUser } from "../../lib/auth/users.ts";

test("generateTempPassword: 24 base64url chars, differs each call, uses randomBytes not Math.random", () => {
  const a = generateTempPassword(), b = generateTempPassword();
  assert.match(a, /^[A-Za-z0-9_-]{24}$/);
  assert.notEqual(a, b);
  const src = readFileSync(new URL("../../lib/auth/users.ts", import.meta.url), "utf8");
  assert.ok(src.includes("randomBytes("), "randomBytes missing");
  assert.ok(!src.includes("Math.random"), "Math.random used");
});

function fakeAdmin({ createError = null, insertError = null, insertCode, users = [] } = {}) {
  const calls = { create: [], insert: [], deleted: [], updated: [] };
  const admin = {
    auth: {
      admin: {
        createUser: async (a) => (calls.create.push(a), createError ? { data: { user: null }, error: { message: createError } } : { data: { user: { id: "u1" } }, error: null }),
        deleteUser: async (id) => (calls.deleted.push(id), { error: null }),
        updateUserById: async (...a) => (calls.updated.push(a), { error: null }),
        listUsers: async () => ({ data: { users }, error: null }),
      },
    },
    from: () => ({ insert: async (row) => (calls.insert.push(row), { error: insertError ? { message: insertError, code: insertCode } : null }) }),
  };
  return { admin, calls };
}

test("createStaffUser: confirmed auth user + staff profiles row with no password field", async () => {
  const { admin, calls } = fakeAdmin();
  const r = await createStaffUser(admin, "  New@Example.test ", () => "pw123");
  assert.deepEqual(r, { ok: true, email: "new@example.test", password: "pw123" });
  assert.deepEqual(calls.create, [{ email: "new@example.test", password: "pw123", email_confirm: true }]);
  assert.deepEqual(calls.insert, [{ id: "u1", email: "new@example.test", role: "staff", personid: null }]);
});

const DUP = "A user with this email address has already been registered";

test("createStaffUser: existing email with an active profile → 'already exists', auth user untouched", async () => {
  const { admin, calls } = fakeAdmin({ createError: DUP, users: [{ id: "u9", email: "dup@example.test" }], insertError: "duplicate key", insertCode: "23505" });
  const r = await createStaffUser(admin, "dup@example.test");
  assert.equal(r.ok, false);
  assert.match(r.error, /already exists/);
  assert.equal(calls.deleted.length + calls.updated.length, 0);
});

test("createStaffUser: existing auth user with no profile (deactivated) → reactivated as staff, password untouched", async () => {
  const { admin, calls } = fakeAdmin({ createError: DUP, users: [{ id: "other", email: "x@example.test" }, { id: "u9", email: "Gone@Example.test" }] });
  const r = await createStaffUser(admin, "gone@example.test", () => "pw123");
  assert.deepEqual(r, { ok: true, email: "gone@example.test", password: null });
  assert.deepEqual(calls.insert, [{ id: "u9", email: "gone@example.test", role: "staff", personid: null }]);
  assert.equal(calls.deleted.length + calls.updated.length, 0, "auth user modified");
});

test("createStaffUser: reactivation insert fails for another reason → error, not 'already exists'", async () => {
  const { admin } = fakeAdmin({ createError: DUP, users: [{ id: "u9", email: "gone@example.test" }], insertError: "boom", insertCode: "XX000" });
  const r = await createStaffUser(admin, "gone@example.test");
  assert.equal(r.ok, false);
  assert.doesNotMatch(r.error, /already exists/);
});

test("createStaffUser: profiles insert fails → auth user rolled back, no password returned", async () => {
  const { admin, calls } = fakeAdmin({ insertError: "duplicate key" });
  const r = await createStaffUser(admin, "x@example.test", () => "pw123");
  assert.equal(r.ok, false);
  assert.ok(!JSON.stringify(r).includes("pw123"));
  assert.deepEqual(calls.deleted, ["u1"]);
});

test("createStaffUser: invalid email → no calls", async () => {
  const { admin, calls } = fakeAdmin();
  assert.equal((await createStaffUser(admin, "nope")).ok, false);
  assert.equal(calls.create.length, 0);
});
