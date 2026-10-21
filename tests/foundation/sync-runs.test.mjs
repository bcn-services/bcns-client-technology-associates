import { test, before } from "node:test";
import assert from "node:assert/strict";
import { resetDb, sql, one, errorOf } from "./harness.mjs";

const ADMIN_ID = "00000000-0000-4000-8000-000000000002";
const STAFF_ID = "00000000-0000-4000-8000-000000000001";

before(() => {
  resetDb();
  sql(`insert into auth.users (id, email) values ('${ADMIN_ID}','admin@example.test'), ('${STAFF_ID}','staff@example.test');
       insert into profiles (id, email, role) values ('${ADMIN_ID}','admin@example.test','admin'), ('${STAFF_ID}','staff@example.test','staff');`);
});

test("sync_runs: a second queued/running row violates the partial unique index; finished rows do not count", () => {
  sql("insert into sync_runs default values;");
  assert.match(errorOf("insert into sync_runs default values;") ?? "", /sync_runs_one_active/);
  sql("update sync_runs set status = 'running';");
  assert.match(errorOf("insert into sync_runs (status) values ('queued');") ?? "", /sync_runs_one_active/);
  sql("update sync_runs set status = 'failed';");
  sql("insert into sync_runs default values;");
  sql("update sync_runs set status = 'succeeded';");
  assert.equal(one("select count(*) from sync_runs"), "2");
});

test("sync_runs: status check rejects unknown values", () => {
  assert.match(errorOf("insert into sync_runs (status) values ('paused');") ?? "", /violates check constraint/);
});

test("sync_runs: admins read it, staff see nothing, nobody authenticated can write", () => {
  const asUser = (id, body) => `set role authenticated; select set_config('request.jwt.claim.sub', '${id}', false); ${body} reset role;`;
  const count = (id) => sql(asUser(id, "select count(*) from sync_runs;")).flat().find((v) => /^\d+$/.test(v));
  assert.equal(count(ADMIN_ID), "2");
  assert.equal(count(STAFF_ID), "0");
  assert.match(errorOf(asUser(ADMIN_ID, "insert into sync_runs default values;")) ?? "", /row-level security|permission denied/);
});
