// Rule 19 (ClearedExpensesAndIncome Update_Click) and rule 16 (frmIncomeEntry CheckCleared_Click).
import { test } from "node:test";
import assert from "node:assert/strict";
import { fakeDb } from "../docs-reports/fakedb.mjs";
import { checkbook, checkbookLines } from "../../lib/reports/checkbook.ts";
import { findPreset, runPreset } from "../../lib/reports/presets.ts";
import { clearedDateOnToggle } from "../../lib/funds/save.ts";

const exp = (expid, expdate, expamount, notCounted, cleared, expdatecleared = null) => ({
  expid, expdate, expamount, exp_notcountedinprofit: notCounted, expclearedbank: cleared, expdatecleared,
  expbankaccount: cleared ? "Bank_Of_America" : null,
});
const fnd = (fndsid, fndsdate, fndspmt, cleared, fndsdatecleared = null) => ({
  fndsid, fndsdate, fndspmt, fndsclearedbank: cleared, fndsdatecleared,
  fndsbankaccount: cleared ? "Bank_Of_America" : null,
});

// Range 2025-03-01..2025-03-31. Witnesses one day outside each end carry large amounts, and two in-range rows
// cleared OUTSIDE the range (and one out-of-range row cleared INSIDE it) prove the filter is the entry date.
const world = () => ({
  tblexpenses: [
    exp(1, "2025-02-28", "1000.00", "900.00", true, "2025-03-05"), // before range, cleared inside it → out
    exp(2, "2025-03-01", "100.10", null, true, "2025-03-02"),      // range start, cleared
    exp(3, "2025-03-15", "50.05", "0.00", false),                  // uncleared → still counted
    exp(4, "2025-03-20", "0.00", "2500.00", false),                // a pure not-counted (owner draw) row
    exp(5, "2025-03-31", "19.95", "300.01", true, "2025-04-10"),   // range end, cleared after it → in
    exp(6, "2025-04-01", "7000.00", "70.00", false),               // after range → out
  ],
  tblfundsrcvd: [
    fnd(1, "2025-02-28", "4000.00", true, "2025-03-03"),
    fnd(2, "2025-03-01", "1500.00", false),
    fnd(3, "2025-03-31", "2000.25", true, "2025-04-02"),
    fnd(4, "2025-04-01", "6000.00", true, "2025-03-31"),
  ],
});
const RANGE = { start: "2025-03-01", end: "2025-03-31" };

const asMap = (lines) => Object.fromEntries(lines.map((l) => [l.label, l.amount]));

test("rule 19: totals over the entry-date range, cleared or not, both ends inclusive", async () => {
  const db = fakeDb(world());
  const data = await checkbook(db, RANGE.start, RANGE.end);
  // Expenses   100.10 + 50.05 + 0.00 + 19.95             = 170.10
  // Non-profit 0 (null) + 0.00 + 2500.00 + 300.01         = 2800.01
  // Income     1500.00 + 2000.25                          = 3500.25
  assert.deepEqual(asMap(data.lines), {
    Expenses: "170.10",
    "Non-profit": "2,800.01",
    Income: "3,500.25",
    Net: "3,330.15",                 // Income − Expenses
    CheckBook: "530.14",             // Income − Expenses − Non-profit
    "Total withdrawals": "2,970.11", // Expenses + Non-profit
  });
  assert.deepEqual(data.lines.map((l) => l.label), ["Expenses", "Non-profit", "Income", "Net", "CheckBook", "Total withdrawals"]);
  assert.equal(db.writes, 0);
});

test("rule 19: CheckBook can go negative and cents never drift", () => {
  const lines = checkbookLines(
    [{ expamount: "0.10", exp_notcountedinprofit: "0.20" }, { expamount: 0.1, exp_notcountedinprofit: null }],
    [{ fndspmt: "0.30" }],
  );
  const c = Object.fromEntries(lines.map((l) => [l.label, l.cents]));
  assert.deepEqual(c, { Expenses: 20, "Non-profit": 20, Income: 30, Net: 10, CheckBook: -10, "Total withdrawals": 40 });
  assert.equal(lines.find((l) => l.label === "CheckBook").amount, "-0.10");
});

test("rule 19: an empty range is all zeros (legacy Nz)", async () => {
  const data = await checkbook(fakeDb(world()), "2030-01-01", "2030-12-31");
  for (const l of data.lines) assert.equal(l.amount, "0.00", l.label);
});

test("rule 19: the Checkbook Comparison preset hands the submitted range through unchanged", async () => {
  const p = findPreset("checkbook");
  assert.deepEqual(p.params(RANGE), RANGE);
  const { engine, data } = await runPreset(fakeDb(world()), p, RANGE);
  assert.equal(engine, "checkbook");
  assert.equal(asMap(data.lines).CheckBook, "530.14");
});

test("rule 16: ticking Cleared stamps the firm's today, unticking blanks it", () => {
  // 02:30 UTC on Oct 4 is still Oct 3 in Connecticut — the date the office sees.
  const now = new Date("2026-10-04T02:30:00Z");
  assert.equal(clearedDateOnToggle(true, now), "2026-10-03");
  assert.equal(clearedDateOnToggle(false, now), "");
  assert.equal(clearedDateOnToggle(true, new Date("2026-10-04T12:00:00Z")), "2026-10-04");
});
