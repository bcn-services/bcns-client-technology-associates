import test from "node:test";
import assert from "node:assert/strict";
import { fakeDb } from "./fakedb.mjs";

const { expenseDetail, incomeDetail } = await import("../../lib/reports/detail.ts");

const MARCH = { start: "2025-03-01", end: "2025-03-31" };

const exp = (expid, expdate, exptype, expbranch, expdscr, expamount, expcaseid) => ({
  expid, expdate, exptype, expbranch, expdscr, expamount, expcaseid,
  expinit: 3, expreason: `reason ${expid}`, expchecknum: 1000 + expid, expbillid: null, expclearedbank: null,
});

// Seeded scrambled on purpose: the fake's .order() is a no-op, so any date-ordering assertion below can only
// pass if lib/reports/detail.ts sorted the assembled rows itself.
const world = () => ({
  tblexpenses: [
    exp(105, "2025-04-01", 6, "Main", "Liberum Advisors fee", 99.99, 55),   // adjacent month, after; only row of type 6
    exp(101, "2025-03-28", 9, "Main", "Liberum Advisors fee", 0.28, 55),
    exp(104, "2025-02-28", 9, "Main", "Liberum Advisors fee", 88.88, 55),   // adjacent month, before
    exp(103, "2025-03-15", 8, "Main", "Liberum Advisors fee", 0.2, 56),     // type decoy (retired, active false)
    exp(107, "2025-03-12", 9, "Main", "All Consultants retainer", 0.01, 57), // description decoy
    exp(106, "2025-03-10", 9, "Other", "Liberum Advisors fee", 0.01, 58),     // branch decoy
    exp(102, "2025-03-05", 7, "Main", "Liberum Advisors fee", 8.29, 59),      // interior, sole type-7 row
  ],
  tblexptype: [
    { exptypeid: 9, exptype: "Active Type", active: true },
    { exptypeid: 6, exptype: "Quiet Type", active: true },
    { exptypeid: 8, exptype: "Retired False", active: false },
    { exptypeid: 7, exptype: "Retired Null", active: null },
  ],
  tblbillingnames: [{ personid: 3, initials: "KB", billingfactor: 1 }],
  tblfundsrcvd: [
    { fndsid: 201, fndsdate: "2025-03-05", fndscaseid: 55, fndspmt: 100.0, fndspayee: "Acme", fndsdesc: "Retainer", fndsbranch: "Main" },
    { fndsid: 202, fndsdate: "2025-03-02", fndscaseid: null, fndspmt: 50.0, fndspayee: "Firm", fndsdesc: "Interest", fndsbranch: "Main" },
    { fndsid: 203, fndsdate: "2025-04-02", fndscaseid: 55, fndspmt: 7.0, fndspayee: "Acme", fndsdesc: "Retainer", fndsbranch: "Main" },
  ],
  tblcase: [{ caseid: 55, caseatty: 900 }, { caseid: 56, caseatty: 900 }, { caseid: 57, caseatty: 900 }, { caseid: 58, caseatty: 900 }],
  tblattorney: [{ attyid: 900, attylastname: "Stone", attyfirstname: "Jon" }],
});

// T1 — firm-wide rows (expcaseid null) are in the report, not orphans.
test("T1 expense detail includes rows whose expcaseid is null", async () => {
  const w = world();                                  // row 199 is the only null-expcaseid row in the suite,
  w.tblexpenses.push(exp(199, "2025-03-20", 9, "Main", "Liberum Advisors fee", 1.0, null)); // and only this test sees it
  const { rows } = await expenseDetail(fakeDb(w), MARCH);
  assert.ok(rows.some((r) => r.expid === 199), "firm-wide row 199 (expcaseid null) missing from the range");
});

// T2 — active gates the picker, never the report: both flavours of retired (null and false) still resolve.
test("T2 retired expense types (active null and active false) still name their rows", async () => {
  const { summary } = await expenseDetail(fakeDb(world()), MARCH);
  assert.deepEqual(summary.filter((s) => s.exptype === 7 || s.exptype === 8).map((s) => s.typeName).sort(), ["Retired False", "Retired Null"]);
});

// T3a — exact date-range boundary: both boundary dates in, both adjacent-month rows out.
test("T3a date range is inclusive at both ends and excludes adjacent months", async () => {
  const w = world();                                  // 108/109 sit ON the boundaries and exist only here,
  w.tblexpenses.push(exp(108, "2025-03-01", 9, "Main", "Liberum Advisors fee", 1.0, 55));  // so a one-day
  w.tblexpenses.push(exp(109, "2025-03-31", 9, "Main", "Liberum Advisors fee", 1.0, 55));  // shift is visible
  const { rows } = await expenseDetail(fakeDb(w), MARCH);                                   // to this test alone
  assert.deepEqual(rows.map((r) => r.expid).sort((a, b) => a - b), [101, 102, 103, 106, 107, 108, 109]);
});

// T3b — ordering asserted on the MODULE's output against a scrambled fixture and a no-op fake .order().
test("T3b rows come back ordered by date", async () => {
  const { rows } = await expenseDetail(fakeDb(world()), MARCH);
  assert.deepEqual(rows.map((r) => r.expdate), ["2025-03-05", "2025-03-10", "2025-03-12", "2025-03-15", "2025-03-28"]);
});

// T4 — type filter; 102 and 103 are decoys differing from the target only in exptype.
test("T4 type filter returns that type only", async () => {
  const { rows } = await expenseDetail(fakeDb(world()), { ...MARCH, exptype: 9 });
  assert.deepEqual(rows.map((r) => r.expid).sort((a, b) => a - b), [101, 106, 107]);
});

// T4b — branch filter; 106 is a decoy differing only in expbranch.
test("T4b branch filter returns that branch only", async () => {
  const { rows } = await expenseDetail(fakeDb(world()), { ...MARCH, branch: "Main" });
  assert.deepEqual(rows.map((r) => r.expid).sort((a, b) => a - b), [101, 102, 103, 107]);
});

// T4c — description substring filter; 107 is a decoy differing only in expdscr.
test("T4c description filter matches a vendor substring only", async () => {
  const { rows } = await expenseDetail(fakeDb(world()), { ...MARCH, description: "Liberum" });
  assert.deepEqual(rows.map((r) => r.expid).sort((a, b) => a - b), [101, 102, 103, 106]);
});

// T5 — a range spanning more than one 1000-row page returns every row.
test("T5 a range of 2500 matching rows returns all 2500", async () => {
  const w = world();
  w.tblexpenses = Array.from({ length: 2500 }, (_, i) =>
    exp(1000 + i, `2025-03-${String((i % 20) + 5).padStart(2, "0")}`, 9, "Main", "bulk", 1.0, 55));
  const { rows } = await expenseDetail(fakeDb(w), MARCH);
  assert.equal(rows.length, 2500);
});

// T6 — integer-cent math. Type 9 (0.28 + 0.01 + 0.01) floats to 30.000000000000004; 8.29 floats to 828.9999999999999,
// so truncating instead of rounding loses a cent and a float grand total lands on 878.9999999999999.
test("T6 per-type summary and grand total equal the detail rows to the cent", async () => {
  const { summary, totalCents } = await expenseDetail(fakeDb(world()), MARCH);
  assert.deepEqual(
    { totalCents, byType: Object.fromEntries(summary.filter((s) => s.count > 0).map((s) => [s.exptype, [s.count, s.totalCents]])) },
    { totalCents: 879, byType: { 9: [3, 30], 8: [1, 20], 7: [1, 829] } },
  );
});

// T7 — read-only, proved by a statement counter on the real engine, not by reading the source.
test("T7 the engine issues no insert, update or delete", async () => {
  const db = fakeDb(world());
  await expenseDetail(db, { ...MARCH, exptype: 9, branch: "Main", description: "Liberum" });
  await incomeDetail(db, { ...MARCH, branch: "Main", description: "Retainer" });
  assert.equal(db.writes, 0);
});

// T8 — income detail: firm-wide receipts included with a blank attorney, case receipts carry the case's attorney.
test("T8 income detail joins the attorney and keeps firm-wide receipts", async () => {
  const { rows, totalCents } = await incomeDetail(fakeDb(world()), MARCH);
  assert.deepEqual(rows.map((r) => [r.fndsid, r.attorney, r.fndscaseid, r.amountCents]).concat([["total", totalCents]]),
    [[202, "", null, 5000], [201, "Stone, Jon", 55, 10000], ["total", 15000]]);
});

// T9 — the summary names only types with activity in the period; type 6's single row sits in an adjacent month.
test("T9 summary omits types with no rows in the period", async () => {
  const { summary } = await expenseDetail(fakeDb(world()), MARCH);
  assert.deepEqual(summary.map((s) => s.exptype).sort((a, b) => a - b), [7, 8, 9]);
});
