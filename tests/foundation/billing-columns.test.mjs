import { test, before } from "node:test";
import assert from "node:assert/strict";
import { resetDb, sql, errorOf, insertSql, syncSequences } from "./harness.mjs";
import { rows, CASE_ID } from "./fixtures/rows.ts";

before(() => { resetDb(); sql(rows.map(([t, r]) => insertSql(t, r)).join("\n")); syncSequences(); });

const bill = (extra) => insertSql("tblbills", { billcaseid: CASE_ID, billdate: "2026-03-01", billhours: 1, billbalance: 100, billnotice: "First", ...extra });
const act = (extra) => insertSql("tblactivity", { actcaseid: CASE_ID, actdate: "2026-03-01", actdescription: "x", acthrs: 1, actwho: 1, ...extra });

test("billtype accepts the six values and rejects others", () => {
  for (const t of ["blank", "timesheet", "depoprep", "depo", "trial", "retainer"]) assert.equal(errorOf(bill({ billtype: t })), undefined, t);
  assert.match(errorOf(bill({ billtype: "invoice" })) ?? "", /check constraint/);
});

test("actbillid implies actbilled; legacy pair (billed, no bill) stays valid", () => {
  assert.match(errorOf(act({ actbillid: 1, actbilled: false })) ?? "", /tblactivity_billed_pair/);
  assert.equal(errorOf(act({ actbillid: 1, actbilled: true })), undefined);
  assert.equal(errorOf(act({ actbilled: true })), undefined);
  assert.equal(sql("select count(*) from tblactivity where actbilled = false and actbillid is null")[0][0], "1");
});

test("supersedesbillid references an existing bill", () => {
  assert.equal(errorOf(bill({ supersedesbillid: 1 })), undefined);
  assert.match(errorOf(bill({ supersedesbillid: 0 })) ?? "", /foreign key/);
});
