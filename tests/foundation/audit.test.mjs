import { test, before } from "node:test";
import assert from "node:assert/strict";
import { resetDb, sql, one, errorOf, insertSql, syncSequences } from "./harness.mjs";
import { rows } from "./fixtures/rows.ts";

const STAFF_ID = "00000000-0000-4000-8000-000000000001";
const ADMIN_ID = "00000000-0000-4000-8000-000000000002";
const asUser = (id, body) => `set role authenticated; select set_config('request.jwt.claim.sub', '${id}', false); ${body} reset role;`;

before(() => {
  resetDb(); sql(rows.map(([t, r]) => insertSql(t, r)).join("\n")); syncSequences();
  sql(`insert into auth.users (id, email) values ('${STAFF_ID}','staff@example.test'), ('${ADMIN_ID}','admin@example.test');`);
  sql(insertSql("profiles", { id: STAFF_ID, email: "staff@example.test", role: "staff" }));
  sql(insertSql("profiles", { id: ADMIN_ID, email: "admin@example.test", role: "admin" }));
});

test("insert/update/delete of one tblexpenses row produces three audit_log rows", () => {
  const EXPID = 999;
  sql(insertSql("tblexpenses", { expid: EXPID, expcaseid: 90001, expdate: "2026-04-01", expdscr: "audit test", expchecknum: 1, expamount: 5 }));
  sql(`update tblexpenses set expamount = 6 where expid = ${EXPID};`);
  sql(`delete from tblexpenses where expid = ${EXPID};`);

  const logged = sql(`select op, (olddata is null)::text, (newdata is null)::text from audit_log where tablename = 'tblexpenses' and rowid = '${EXPID}' order by id`);
  assert.equal(logged.length, 3);
  assert.deepEqual(logged[0], ["INSERT", "true", "false"]);
  assert.deepEqual(logged[1], ["UPDATE", "false", "false"]);
  assert.deepEqual(logged[2], ["DELETE", "false", "true"]);
});

test("every public table except audit_log has a trigger named audit", () => {
  const tables = sql("select table_name from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE' and table_name <> 'audit_log'").map((r) => r[0]);
  assert.ok(tables.length > 0);
  for (const t of tables) {
    assert.equal(one(`select count(*) from pg_trigger where tgname = 'audit' and tgrelid = '${t}'::regclass`), "1", `${t} missing audit trigger`);
  }
});

test("insert into audit_log as authenticated is denied", () => {
  const err = errorOf("set role authenticated; insert into audit_log (tablename, rowid, op) values ('x','1','INSERT'); reset role;");
  assert.match(err ?? "", /permission denied|row-level security/);
});

test("audit_log SELECT is admin-only: staff see 0 rows, admin sees every row", () => {
  const total = Number(one("select count(*) from audit_log"));
  assert.ok(total > 0, "fixture produced no audit rows, so the check would be vacuous");
  const count = (id) => sql(asUser(id, "select count(*) from audit_log;")).at(-1)[0];
  assert.equal(count(STAFF_ID), "0");
  assert.equal(count(ADMIN_ID), String(total));
});

test("a staff write is still audited (trigger is security definer) with the staff actor", () => {
  const EXPID = 998;
  const row = insertSql("tblexpenses", { expid: EXPID, expcaseid: 90001, expdate: "2026-04-01", expdscr: "staff write", expchecknum: 1, expamount: 5 });
  assert.equal(errorOf(asUser(STAFF_ID, row)), undefined);
  assert.deepEqual(sql(`select op, actor from audit_log where tablename = 'tblexpenses' and rowid = '${EXPID}'`), [["INSERT", STAFF_ID]]);
});

test("the (tablename, rowid, id desc) index exists", () => {
  assert.equal(one("select count(*) from pg_indexes where tablename = 'audit_log' and indexname = 'audit_log_table_row_idx'"), "1");
});
