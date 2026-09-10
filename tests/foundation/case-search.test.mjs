import { test, before } from "node:test";
import assert from "node:assert/strict";
import { resetDb, sql, one, errorOf, insertSql, syncSequences } from "./harness.mjs";
import { rows, CASE_ID } from "./fixtures/rows.ts";

before(() => { resetDb(); sql(rows.map(([t, r]) => insertSql(t, r)).join("\n")); syncSequences(); });

test("case_search carries the fixture case with joined attorney, firm, client names", () => {
  const [r] = sql(`select caseid, casetitle, attyname, frmname, clientname from case_search where caseid = ${CASE_ID}`);
  assert.deepEqual(r, [String(CASE_ID), "Sample v. Example", "Pat Example", "Example & Partners LLP", "Sam Sample"]);
});

test("a case whose attorney and client rows are missing still appears (NOT VALID FKs)", () => {
  // NOT VALID still checks new rows; legacy orphans only arrive via import, simulated by skipping FK triggers.
  sql("set session_replication_role = replica;\n" + insertSql("tblcase", { caseid: 90002, caseatty: 99999, casetitle: "Orphan v. Nobody", caseclient: 99999, tabranch: "Hartford", status: "Open", casestartdate: "2026-03-01", billingalert: false }));
  assert.equal(one("select attyname || '|' || clientname || '|' || coalesce(frmname,'null') from case_search where caseid = 90002"), "||null");
});

test("anon cannot read case_search; authenticated can", () => {
  assert.match(errorOf("set role anon; select 1 from case_search limit 1;") ?? "", /permission denied/);
  assert.equal(errorOf("set role authenticated; select 1 from case_search limit 1;"), undefined);
});
