// Unit test for tests/app-shell/seed-e2e.ts: only the staff E2E seed path (seedStaffE2e) links personid 1 (KJS);
// the shared seedE2eUser every live test uses for throwaway accounts still writes personid null.
// Each path writes exactly one row (the profiles upsert) on both the created and existing auth paths.
import { test } from "node:test";
import assert from "node:assert/strict";
import { seedE2eUser, seedStaffE2e, STAFF_PERSONID } from "../app-shell/seed-e2e.ts";

function fakeAdmin({ existing, email, createdId, existingId }) {
  const writes = [];
  const table = (name) => {
    const rec = (op) => (payload, opts) => { writes.push({ table: name, op, payload, opts }); return Promise.resolve({ data: null, error: null }); };
    return { upsert: rec("upsert"), insert: rec("insert"), update: rec("update"), delete: rec("delete") };
  };
  const admin = {
    auth: { admin: {
      createUser: async () => existing
        ? { data: { user: null }, error: { message: "A user with this email address has already been registered" } }
        : { data: { user: { id: createdId } }, error: null },
      listUsers: async () => ({ data: { users: [{ id: "uid-other-3b9", email: "x@example.test" }, { id: existingId, email }] }, error: null }),
      updateUserById: async () => ({ data: {}, error: null }),
    } },
    from: table,
  };
  return { admin, writes };
}

test("(h) STAFF_PERSONID is 1 (KJS)", () => {
  assert.equal(STAFF_PERSONID, 1);
});

const STAFF = { email: "staff-seed-a41@example.test", createdId: "uid-staff-created-7c1", existingId: "uid-staff-existing-5e2" };
for (const [path, existing] of [["created", false], ["existing", true]]) {
  test(`(i) staff seed (${path}): exactly one profiles upsert { id, email, role: staff, personid: 1 } on id, no other writes`, async () => {
    const { admin, writes } = fakeAdmin({ existing, ...STAFF });
    const id = existing ? STAFF.existingId : STAFF.createdId;
    const r = await seedStaffE2e(admin, STAFF.email, "pw");
    assert.deepEqual(r, { id, status: path });
    assert.deepEqual(writes, [{ table: "profiles", op: "upsert", payload: { id, email: STAFF.email, role: "staff", personid: STAFF_PERSONID }, opts: { onConflict: "id" } }]);
  });
}

const PLAIN = { email: "throwaway-seed-b82@example.test", createdId: "uid-plain-created-9d4", existingId: "uid-plain-existing-2f6" };
for (const [path, existing] of [["created", false], ["existing", true]]) {
  test(`regression (${path}): plain seedE2eUser(admin, email, pw) upserts personid null, not KJS`, async () => {
    const { admin, writes } = fakeAdmin({ existing, ...PLAIN });
    const id = existing ? PLAIN.existingId : PLAIN.createdId;
    await seedE2eUser(admin, PLAIN.email, "pw");
    assert.deepEqual(writes, [{ table: "profiles", op: "upsert", payload: { id, email: PLAIN.email, role: "staff", personid: null }, opts: { onConflict: "id" } }]);
  });
}
