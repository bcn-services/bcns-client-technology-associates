import { test } from "node:test";
import assert from "node:assert/strict";
import { getSession, requireSession, ForbiddenError } from "../../lib/auth/session.ts";

const fake = (user, profile) => ({
  auth: { getUser: async () => ({ data: { user } }) },
  from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: profile }) }) }) }),
});
const USER = { id: "00000000-0000-4000-8000-000000000001", email: "staff@example.test" };

test("no auth user → null", async () => assert.equal(await getSession(fake(null, null)), null));
test("user with profile → pinned Session shape", async () => {
  assert.deepEqual(await getSession(fake(USER, { role: "staff", personid: 2 })), { userId: USER.id, email: USER.email, role: "staff", personId: 2 });
});
test("user without profiles row → null", async () => assert.equal(await getSession(fake(USER, null)), null));
test("requireSession redirects to /login exactly once when no session", async () => {
  const calls = [];
  const redirect = (u) => { calls.push(u); throw new Error("NEXT_REDIRECT"); };
  await assert.rejects(requireSession(undefined, fake(null, null), { redirect }), /NEXT_REDIRECT/);
  assert.deepEqual(calls, ["/login"]);
});
test("requireSession('admin') as staff throws ForbiddenError; as admin returns session", async () => {
  await assert.rejects(requireSession("admin", fake(USER, { role: "staff", personid: null })), ForbiddenError);
  const s = await requireSession("admin", fake(USER, { role: "admin", personid: 1 }));
  assert.equal(s.role, "admin");
});
test("createServerClient with no env throws DbNotConfiguredError", async () => {
  const { createServerClient, DbNotConfiguredError } = await import("../../lib/db/client.ts");
  delete process.env.NEXT_PUBLIC_SUPABASE_URL; delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  assert.throws(() => createServerClient(), DbNotConfiguredError);
});
