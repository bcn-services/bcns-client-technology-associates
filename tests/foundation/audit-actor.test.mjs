// Migration 0010: audit_log.actor = coalesce(auth.uid(), x-app-actor request header).
// PostgREST sets request.headers / request.jwt.claim.sub per request; set_config stands in.
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { resetDb, sql, one, insertSql, syncSequences } from "./harness.mjs";
import { rows } from "./fixtures/rows.ts";

before(() => { resetDb(); sql(rows.map(([t, r]) => insertSql(t, r)).join("\n")); syncSequences(); });

const HEADER_USER = "11111111-1111-4111-8111-111111111111";
const JWT_USER = "22222222-2222-4222-8222-222222222222";
let nextId = 5000;

/** Insert one expense in a fresh session with the given GUCs; return the audit actor ("null" = no actor). */
function actorFor({ headers, sub } = {}) {
  const id = nextId++;
  const setup = [
    headers !== undefined && `select set_config('request.headers', ${lit(headers)}, false);`,
    sub !== undefined && `select set_config('request.jwt.claim.sub', ${lit(sub)}, false);`,
  ].filter(Boolean).join("\n");
  sql(`${setup}\n${insertSql("tblexpenses", { expid: id, expcaseid: 90001, expdate: "2026-04-01", expdscr: "actor test", expchecknum: 1, expamount: 5 })}`);
  assert.equal(one(`select count(*) from tblexpenses where expid = ${id}`), "1", "the write itself must succeed");
  return one(`select coalesce(actor::text, 'null') from audit_log where tablename = 'tblexpenses' and rowid = '${id}' and op = 'INSERT'`);
}
const lit = (s) => "'" + s.replace(/'/g, "''") + "'";

test("valid x-app-actor header → actor is that uuid", () => {
  assert.equal(actorFor({ headers: JSON.stringify({ "x-app-actor": HEADER_USER }) }), HEADER_USER);
});

test("garbage header → actor null, write still succeeds", () => {
  for (const bad of ["not-a-uuid", "", "11111111-1111-4111-8111-11111111111", "'; drop table audit_log; --", `${HEADER_USER}x`]) {
    assert.equal(actorFor({ headers: JSON.stringify({ "x-app-actor": bad }) }), "null", bad);
  }
  assert.equal(actorFor({ headers: JSON.stringify({ "x-app-actor": 42 }) }), "null", "non-string value");
  assert.equal(actorFor({ headers: "{not json" }), "null", "unparseable request.headers");
});

test("no header → actor null", () => {
  assert.equal(actorFor(), "null", "request.headers unset");
  assert.equal(actorFor({ headers: JSON.stringify({ "user-agent": "x" }) }), "null", "headers without x-app-actor");
});

test("auth.uid() wins over the header", () => {
  assert.equal(actorFor({ sub: JWT_USER, headers: JSON.stringify({ "x-app-actor": HEADER_USER }) }), JWT_USER);
  assert.equal(actorFor({ sub: JWT_USER }), JWT_USER, "JWT alone");
});

test("update and delete record the header actor too", () => {
  const h = `select set_config('request.headers', ${lit(JSON.stringify({ "x-app-actor": HEADER_USER }))}, false);`;
  const id = nextId++;
  sql(insertSql("tblexpenses", { expid: id, expcaseid: 90001, expdate: "2026-04-01", expdscr: "u/d", expchecknum: 1, expamount: 5 }));
  sql(`${h} update tblexpenses set expamount = 6 where expid = ${id}; delete from tblexpenses where expid = ${id};`);
  const got = sql(`select op, coalesce(actor::text, 'null') from audit_log where tablename = 'tblexpenses' and rowid = '${id}' order by id`);
  assert.deepEqual(got, [["INSERT", "null"], ["UPDATE", HEADER_USER], ["DELETE", HEADER_USER]]);
});
