import { test, before } from "node:test";
import assert from "node:assert/strict";
import { resetDb, sql, errorOf, insertSql, syncSequences } from "./harness.mjs";
import { rows } from "./fixtures/rows.ts";

before(() => { resetDb(); sql(rows.map(([t, r]) => insertSql(t, r)).join("\n")); syncSequences(); });

const txn = (extra) => insertSql("bank_transactions", { bankaccount: "OperatingChecking", postedon: "2026-03-01", amount: 10, description: "Test txn", ...extra });

test("re-inserting the same (bankaccount, postedon, amount, description) fails unique", () => {
  assert.equal(errorOf(txn({})), undefined);
  assert.match(errorOf(txn({})) ?? "", /unique/);
});

test("expid and fndsid may both be null; an unknown expid is rejected", () => {
  assert.equal(errorOf(txn({ postedon: "2026-03-02" })), undefined);
  assert.match(errorOf(txn({ postedon: "2026-03-03", expid: 999999 })) ?? "", /foreign key/);
});
