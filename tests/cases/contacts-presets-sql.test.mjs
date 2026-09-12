/**
 * SQL-level check of the five contact presets: the legacy Access queries (MSysQueries,
 * translated to Postgres — INNER joins, case-insensitive compare, SQL Server nulls-first,
 * primary-key tiebreaks) run on a real Postgres seeded with tests/cases/contacts-seed.mjs,
 * compared row-for-row and in order with lib/contacts/presets.ts fed the same tables.
 * Uses its own database (ta_contacts) so it never clobbers the shared ta_foundation.
 */
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { states, firms, attys, cases } from "./contacts-seed.mjs";
import { PRESETS } from "../../lib/contacts/presets.ts";

process.env.FOUNDATION_PG_URL = process.env.CONTACTS_PG_URL ?? "postgresql://localhost/ta_contacts";
const { resetDb, sql, one, insertSql } = await import("../foundation/harness.mjs");

let t;
before(() => {
  resetDb();
  sql([
    ...states.map((state) => insertSql("tblstates", { state })),
    // Orphans and off-list states ("ct") only arrive via legacy import — skip FK triggers as the case-search test does.
    "set session_replication_role = replica;",
    ...firms.map((r) => insertSql("tblfirm", r)),
    ...attys.map((r) => insertSql("tblattorney", r)),
    ...cases.map((r) => insertSql("tblcase", { ...r, caseclient: 1, tabranch: "Hartford", status: "Open", casestartdate: "2026-03-01", billingalert: false })),
  ].join("\n"));
  // json_agg text breaks lines between elements and harness one() keeps only the first line.
  const load = (q) => JSON.parse(one(`select replace(coalesce(json_agg(t), '[]')::text, E'\\n', ' ') from (${q}) t`));
  t = {
    firms: load("select frmid, frmname, frmaddress1, frmaddress2, frmcity, frmstate, frmzip, frmphone, frmactive from tblfirm"),
    attys: load("select attyid, attyfirmid, attytitle, attyfirstname, attymiddlename, attylastname, attysuffix, attyesq, attyphone from tblattorney"),
    cases: load("select caseid, casetitle, caseatty from tblcase"),
  };
});

const ci = (c) => `lower(${c}) collate "C" nulls first`;
const lit = (v) => "'" + v.replace(/'/g, "''") + "'";
const LEGACY_SQL = {
  "active-firms": (v) => `select f.frmactive, a.attyfirstname, a.attylastname, f.frmname, f.frmaddress1, f.frmaddress2, f.frmcity, f.frmstate, f.frmzip
    from tblfirm f join tblattorney a on f.frmid = a.attyfirmid where lower(f.frmactive) = lower(${lit(v)})
    order by ${ci("f.frmname")}, f.frmid, a.attyid`,
  duplicates: () => `select a.attyid, a.attyfirstname, a.attylastname, a.attyfirmid, f.frmname, f.frmaddress1, f.frmaddress2, f.frmcity, f.frmstate, f.frmzip, f.frmphone
    from tblfirm f join tblattorney a on f.frmid = a.attyfirmid order by ${ci("a.attylastname")}, a.attyfirmid, a.attyid`,
  rename: () => `select f.frmname, coalesce(a.attyfirstname,'') || ' ' || coalesce(a.attylastname,''), a.attyid, f.frmphone, a.attyphone, a.attyfirmid, f.frmaddress1, f.frmaddress2, f.frmzip
    from tblfirm f join tblattorney a on f.frmid = a.attyfirmid order by ${ci("f.frmname")}, f.frmid, a.attyid`,
  "attorney-ids": () => `select a.attylastname, c.caseid, c.caseatty, a.attyfirmid, a.attytitle, a.attyfirstname, a.attymiddlename, a.attysuffix, a.attyesq
    from tblattorney a join tblcase c on a.attyid = c.caseatty order by c.caseatty nulls first, c.caseid`,
  "by-state": (v) => `select c.caseid, c.casetitle, f.frmstate
    from tblfirm f join tblattorney a on f.frmid = a.attyfirmid join tblcase c on a.attyid = c.caseatty
    where lower(f.frmstate) = lower(${lit(v)}) order by c.caseid`,
};
// psql -At prints null as '' and booleans as t/f.
const asPsql = (v) => (v == null ? "" : typeof v === "boolean" ? (v ? "t" : "f") : String(v));

const CASES = [
  ["active-firms", "Yes"], ["active-firms", "no"], ["active-firms", "-1"], ["active-firms", "True"],
  ["duplicates", ""], ["rename", ""], ["attorney-ids", ""], ["by-state", "NY"], ["by-state", "ct"],
];
for (const [name, value] of CASES) {
  test(`${name}${value ? ` (${value})` : ""}: same rows, same order as the legacy query`, () => {
    const want = sql(LEGACY_SQL[name](value));
    assert.ok(want.length > 0, "seed set must exercise the preset");
    const p = PRESETS[name];
    const got = p.run(structuredClone(t), value).map((r) => p.cols.map((c) => asPsql(r[c.key])));
    assert.deepEqual(got, want);
  });
}
