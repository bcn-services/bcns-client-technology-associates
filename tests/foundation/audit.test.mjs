import { test, before } from "node:test";
import assert from "node:assert/strict";
import { resetDb, sql, one, errorOf, insertSql, syncSequences } from "./harness.mjs";
import { rows } from "./fixtures/rows.ts";

before(() => { resetDb(); sql(rows.map(([t, r]) => insertSql(t, r)).join("\n")); syncSequences(); });

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
