import test from "node:test";
import assert from "node:assert/strict";
import { fakeDb } from "./fakedb.mjs";

// Contract D5: P&L and the accountant export honour the selected from/to range — not the calendar year.
const { pnlRange, pnl } = await import("../../lib/reports/pnl.ts");
const { buildWorkbook, accountantPlan, workbookFilename } = await import("../../lib/reports/export.ts");
const { findPreset, runPreset, isRangeFor, MAX_PNL_RANGE_MONTHS } = await import("../../lib/reports/presets.ts");

const exp = (expid, expdate, expamount, exp_notcountedinprofit = null) => ({
  expid, expdate, exptype: 9, expamount, exp_notcountedinprofit,
  expcaseid: 55, expbranch: "Main", expdscr: `vendor ${expid}`, expreason: null, expchecknum: null, expinit: 3,
});
const fnd = (fndsid, fndsdate, fndspmt) => ({
  fndsid, fndsdate, fndspmt, fndsbranch: "Main", fndscaseid: 55, fndspayee: "Acme", fndsdesc: `receipt ${fndsid}`,
});

// Each amount is a distinct power of two in cents, so any wrongly included or excluded row changes the sum.
const world = () => ({
  tblexpenses: [
    exp(1, "2024-12-31", 0.01),
    exp(2, "2025-03-14", 0.02),             // day before the mid-year range
    exp(3, "2025-03-15", 0.04, 1.0),        // range start
    exp(4, "2025-05-10", 0.08),
    exp(5, "2025-06-30", 0.16),             // range end
    exp(6, "2025-07-01", 0.32),             // day after
    exp(7, "2025-11-01", 0.64),             // cross-year range start
    exp(8, "2026-02-28", 1.28),             // cross-year range end
    exp(9, "2026-03-01", 2.56),             // day after the cross-year range
  ],
  tblfundsrcvd: [
    fnd(1, "2025-03-14", 10.0),
    fnd(2, "2025-03-15", 20.0),
    fnd(3, "2025-06-30", 40.0),
    fnd(4, "2025-07-01", 80.0),
    fnd(5, "2025-12-15", 160.0),
    fnd(6, "2026-02-28", 320.0),
    fnd(7, "2026-03-01", 640.0),
  ],
  tblexptype: [{ exptypeid: 9, exptype: "Alpha", active: true }],
  tblbillingnames: [{ personid: 3, initials: "KB", billingfactor: 1 }],
  tblcase: [{ caseid: 55, caseatty: 900 }],
  tblattorney: [{ attyid: 900, attylastname: "Stone", attyfirstname: "Jon" }],
});

const MID = { start: "2025-03-15", end: "2025-06-30" };
const CROSS = { start: "2025-11-01", end: "2026-02-28" };

const sheet = (wb, name) => {
  const ws = wb.getWorksheet(name);
  assert.ok(ws, `no sheet "${name}" in ${wb.worksheets.map((w) => w.name).join(" | ")}`);
  return ws;
};
const rowOf = (ws, label) => {
  let hit;
  ws.eachRow((r) => { if (r.getCell(1).value === label) hit = r.values.slice(2); });
  assert.ok(hit, `no "${label}" row`);
  return hit;
};
const cents = (n) => Math.round(n * 100);

test("D5 P&L over a mid-year range counts only rows inside it, one column per month touched", async () => {
  const p = (await runPreset(fakeDb(world()), findPreset("pnl"), MID)).data;
  assert.deepEqual(p.months.map((m) => m.label), ["Mar", "Apr", "May", "Jun"]);
  assert.deepEqual(p.months.map((m) => m.expensesCents), [4, 0, 8, 16]); // 03-14 and 07-01 stay out
  assert.deepEqual(p.months.map((m) => m.incomeCents), [2000, 0, 0, 4000]);
  assert.deepEqual(p.months.map((m) => m.withdrawalsCents), [100, 0, 0, 0]);
  assert.equal(p.total.expensesCents, 28);
  assert.equal(p.total.incomeCents, 6000);
  assert.equal(p.total.netCents, 5972);
  assert.equal(p.total.label, "Total For Period");
});

test("D5 P&L over a cross-year range spans both years in order and labels the columns with the year", async () => {
  const p = (await runPreset(fakeDb(world()), findPreset("pnl"), CROSS)).data;
  assert.deepEqual(p.months.map((m) => m.label), ["Nov 2025", "Dec 2025", "Jan 2026", "Feb 2026"]);
  assert.deepEqual(p.months.map((m) => m.expensesCents), [64, 0, 0, 128]);
  assert.deepEqual(p.months.map((m) => m.incomeCents), [0, 16000, 0, 32000]);
  assert.equal(p.total.expensesCents, 192);
  assert.equal(p.total.incomeCents, 48000);
});

test("D5 pnl(year, asOf) is unchanged: a full year still labels Total For Year, January-first", async () => {
  const full = await pnl(fakeDb(world()), 2025, 12);
  assert.equal(full.months.length, 12);
  assert.equal(full.total.label, "Total For Year");
  assert.equal(full.months[0].label, "Jan");
  const q = await pnlRange(fakeDb(world()), "2025-01-01", "2025-03-31");
  assert.equal(q.months.length, 3);
  assert.equal(q.total.label, "Total For Period", "a Jan..Mar snapshot is not a full year");
  assert.equal((await pnl(fakeDb(world()), 2025, 3)).total.label, "Total For Period");
});

test("D5 accountant export over a mid-year range: only that range's rows, in every sheet", async () => {
  const wb = await buildWorkbook(fakeDb(world()), findPreset("accountant-export"), MID);
  assert.deepEqual(wb.worksheets.map((w) => w.name), [
    "Monthly Income 250315-250331", "Monthly Income Report Apr 2025", "Monthly Income Report May 2025", "Monthly Income Report Jun 2025",
    "Monthly Expense 250315-250331", "Monthly Expense Report Apr 2025", "Monthly Expense Report May 2025", "Monthly Expense Report Jun 2025",
    "Yearly Income 250315-250630", "Yearly Expense 250315-250630",
    "P&L 2025-03-15 to 2025-06-30",
  ]);
  // March expense sheet: the 03-15 row only (03-14 is before the range).
  const mar = sheet(wb, "Monthly Expense 250315-250331");
  const dates = [];
  mar.eachRow((r, i) => { if (i > 1 && /^\d{4}-/.test(String(r.getCell(1).value))) dates.push(r.getCell(1).value); });
  assert.deepEqual(dates, ["2025-03-15"]);
  // June income sheet: 06-30 only. Total row = 40.00.
  const jun = sheet(wb, "Monthly Income Report Jun 2025");
  assert.equal(rowOf(jun, "Total (1 receipt)").at(-1), 40);
  // Yearly rollups carry range totals, not year totals (07-01 and 2024-12-31 stay out).
  const yi = sheet(wb, "Yearly Income 250315-250630");
  assert.equal(cents(rowOf(yi, "Total").at(-1)), 6000);
  const ye = sheet(wb, "Yearly Expense 250315-250630");
  assert.equal(cents(rowOf(ye, "Total").at(-1)), 28);
  // P&L sheet: headings print the range's months and totals match the engine.
  const pl = sheet(wb, "P&L 2025-03-15 to 2025-06-30");
  assert.deepEqual(pl.getRow(1).values.slice(1), ["", "Mar", "Apr", "May", "Jun", "Total For Period"]);
  assert.equal(cents(rowOf(pl, "Net").at(-1)), 5972);
  assert.equal(cents(rowOf(pl, "Expenses").at(-1)), 28);
});

test("D5 accountant export over a cross-year range: a rollup per calendar year, clipped, and one P&L", async () => {
  const wb = await buildWorkbook(fakeDb(world()), findPreset("accountant-export"), CROSS);
  const names = wb.worksheets.map((w) => w.name);
  assert.equal(names.length, 4 + 4 + 2 + 2 + 1);
  assert.deepEqual(names.slice(0, 4), ["Monthly Income Report Nov 2025", "Monthly Income Report Dec 2025", "Monthly Income Report Jan 2026", "Monthly Income Report Feb 2026"]);
  assert.deepEqual(names.slice(8, 12), ["Yearly Income 251101-251231", "Yearly Income 260101-260228", "Yearly Expense 251101-251231", "Yearly Expense 260101-260228"]);
  assert.equal(new Set(names).size, names.length);
  for (const n of names) assert.ok(n.length <= 31, `sheet name too long: ${n}`);
  assert.equal(cents(rowOf(sheet(wb, "Yearly Income 251101-251231"), "Total").at(-1)), 16000);
  assert.equal(cents(rowOf(sheet(wb, "Yearly Income 260101-260228"), "Total").at(-1)), 32000);
  const pl = sheet(wb, "P&L 2025-11-01 to 2026-02-28");
  assert.deepEqual(pl.getRow(1).values.slice(1), ["", "Nov 2025", "Dec 2025", "Jan 2026", "Feb 2026", "Total For Period"]);
  assert.equal(cents(rowOf(pl, "Income").at(-1)), 48000);
});

test("D5 a full calendar year keeps the classic 27-sheet set and file name", async () => {
  const FULL = { start: "2025-01-01", end: "2025-12-31" };
  assert.equal(accountantPlan(FULL).length, 27);
  assert.equal(workbookFilename(findPreset("accountant-export"), FULL), "accountant-export-2025.xlsx");
});

test("D5 the file name for a range names the range, and a P&L export is a single sheet over the range", async () => {
  assert.equal(workbookFilename(findPreset("accountant-export"), MID), "accountant-export-2025-03-15-to-2025-06-30.xlsx");
  assert.equal(workbookFilename(findPreset("pnl"), MID), "pnl-2025-03-15-to-2025-06-30.xlsx");
  const wb = await buildWorkbook(fakeDb(world()), findPreset("pnl"), MID);
  assert.deepEqual(wb.worksheets.map((w) => w.name), ["P&L 2025-03-15 to 2025-06-30"]);
  assert.equal(cents(rowOf(wb.worksheets[0], "Net").at(-1)), 5972);
});

test("D5 a partial month sheet is named by its dates; full months keep the month name; all names unique and <= 31", () => {
  const plan = accountantPlan({ start: "2025-03-15", end: "2026-02-10" });
  const names = plan.map((p) => p.name);
  assert.ok(names.includes("Monthly Income 250315-250331"));
  assert.ok(names.includes("Monthly Expense 260201-260210"));
  assert.ok(names.includes("Monthly Income Report Apr 2025"), "a fully covered month keeps its month name");
  assert.equal(new Set(names).size, names.length);
  for (const n of names) assert.ok(n.length <= 31, n);
  // A range inside one month: a single clipped sheet each, still unique.
  const one = accountantPlan({ start: "2025-03-05", end: "2025-03-20" }).map((p) => p.name);
  assert.equal(new Set(one).size, one.length);
});

test("D5 the P&L and export cap the range at one constant of months; other presets are uncapped", () => {
  assert.equal(MAX_PNL_RANGE_MONTHS, 24);
  const ok = { start: "2025-01-15", end: "2026-12-31" }; // 24 months touched
  const tooLong = { start: "2025-01-01", end: "2027-01-01" }; // 25 months touched
  const huge = { start: "2000-01-01", end: "2026-12-31" };
  for (const key of ["pnl", "accountant-export"]) {
    assert.equal(isRangeFor(findPreset(key), ok), true, `${key} 24 months`);
    assert.equal(isRangeFor(findPreset(key), tooLong), false, `${key} 25 months`);
    assert.equal(isRangeFor(findPreset(key), huge), false, `${key} 27 years`);
    assert.equal(isRangeFor(findPreset(key), { start: "2025-06-30", end: "2025-01-01" }), false, `${key} reversed`);
  }
  assert.equal(isRangeFor(findPreset("monthly-expense"), huge), true);
});
