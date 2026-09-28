import { test, before } from "node:test";
import assert from "node:assert/strict";
import { resetDb, sql, one, errorOf, insertSql, syncSequences } from "./harness.mjs";
import { rows } from "./fixtures/rows.ts";

const STAFF_ID = "00000000-0000-4000-8000-000000000001";
const ADMIN_ID = "00000000-0000-4000-8000-000000000002";

before(() => {
  resetDb();
  sql(rows.map(([t, r]) => insertSql(t, r)).join("\n"));
  syncSequences();
  sql(`insert into auth.users (id, email) values ('${STAFF_ID}','staff@example.test'), ('${ADMIN_ID}','admin@example.test');`);
  sql(insertSql("profiles", { id: STAFF_ID, email: "staff@example.test", role: "staff" }));
  sql(insertSql("profiles", { id: ADMIN_ID, email: "admin@example.test", role: "admin" }));
});

test("authenticated_all sits on all 22 non-profiles/audit_log tables; RLS is on everywhere", () => {
  const withPolicy = sql("select tablename from pg_policies where schemaname='public' and policyname='authenticated_all' order by 1").map((r) => r[0]);
  assert.equal(withPolicy.length, 22); // 21 + tblbilllines (0009)
  assert.ok(!withPolicy.includes("profiles"));
  assert.ok(!withPolicy.includes("audit_log"));

  const tables = sql("select tablename from pg_tables where schemaname='public'").map((r) => r[0]);
  for (const t of tables) {
    assert.equal(one(`select relrowsecurity from pg_class where oid = '${t}'::regclass`), "t", `${t} rls not enabled`);
  }
});

test("role check rejects 'owner'; personid may be null", () => {
  const err = errorOf(`
    insert into auth.users (id, email) values ('00000000-0000-4000-8000-000000000099','bad@example.test');
    insert into profiles (id, email, role) values ('00000000-0000-4000-8000-000000000099','bad@example.test','owner');
  `);
  assert.match(err ?? "", /violates check constraint/);
  assert.equal(one(`select count(*) from profiles where id = '${STAFF_ID}' and personid is null`), "1");
});

test("as anon, tblcase reads return 0 rows or permission denied", () => {
  try {
    const result = sql("set role anon; select count(*) from tblcase; reset role;");
    assert.equal(result[0][0], "0");
  } catch (e) {
    assert.match(String(e.stderr ?? e.message), /permission denied/);
  }
});

test("profiles: staff cannot insert a profile, admin can", () => {
  // set_config(...,false) so the session-scoped GUC survives past the SELECT's own
  // implicit transaction, into the following INSERT within the same psql session/call.
  const asStaff = `
    set role authenticated;
    select set_config('request.jwt.claim.sub', '${STAFF_ID}', false);
    insert into profiles (id, email, role) values ('00000000-0000-4000-8000-000000000003','x@example.test','staff');
    reset role;
  `;
  assert.match(errorOf(asStaff) ?? "", /row-level security/);

  const asAdmin = `
    insert into auth.users (id, email) values ('00000000-0000-4000-8000-000000000004','y@example.test');
    set role authenticated;
    select set_config('request.jwt.claim.sub', '${ADMIN_ID}', false);
    insert into profiles (id, email, role) values ('00000000-0000-4000-8000-000000000004','y@example.test','staff');
    reset role;
  `;
  assert.equal(errorOf(asAdmin), undefined);
});
