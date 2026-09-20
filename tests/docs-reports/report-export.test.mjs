import test from "node:test";
import assert from "node:assert/strict";
import { fakeDb } from "./fakedb.mjs";

const { buildWorkbook, accountantPlan, workbookFilename } = await import("../../lib/reports/export.ts");
const { findPreset, runPreset } = await import("../../lib/reports/presets.ts");

const YEAR = 2025;
const FULL = { start: "2025-01-01", end: "2025-12-31" };
const MARCH = { start: "2025-03-01", end: "2025-03-31" };

// Amounts are float-unfriendly on purpose (0.28, 8.29, 0.01): a cents-via-float mutant cannot land on the
// exact cent by luck, and the workbook asserts against the engine's integer cents, never a display string.
const exp = (expid, expdate, exptype, expamount, exp_notcountedinprofit = null) => ({
  expid, expdate, exptype, expamount, exp_notcountedinprofit,
  expcaseid: 55, expbranch: "Main", expdscr: `vendor ${expid}`, expreason: null, expchecknum: null, expinit: 3,
});
const fnd = (fndsid, fndsdate, fndspmt) => ({
  fndsid, fndsdate, fndspmt, fndsbranch: "Main", fndscaseid: 55, fndspayee: "Acme", fndsdesc: `receipt ${fndsid}`,
});

const world = () => ({
  tblexpenses: [
    exp(101, "2025-01-15", 9, 0.28),
    exp(102, "2025-03-10", 9, 8.29, 1.5),
    exp(103, "2025-03-20", 6, 0.01),
    exp(104, "2025-07-04", 6, 12.34),
  ],
  tblfundsrcvd: [fnd(201, "2025-01-15", 0.28), fnd(202, "2025-03-10", 7.0), fnd(203, "2025-03-20", 0.29), fnd(204, "2025-09-02", 5.11)],
  tblexptype: [{ exptypeid: 9, exptype: "Active Type", active: true }, { exptypeid: 6, exptype: "Quiet Type", active: true }],
  tblbillingnames: [{ personid: 3, initials: "KB", billingfactor: 1 }],
  tblcase: [{ caseid: 55, caseatty: 900 }],
  tblattorney: [{ attyid: 900, attylastname: "Stone", attyfirstname: "Jon" }],
});

const sheetNames = (wb) => wb.worksheets.map((ws) => ws.name);

// C1 — the accountant export is one workbook of 27 sheets: 12 income, 12 expense, 3 rollups.
test("C1 accountant export builds 27 sheets named for report and period", async () => {
  const wb = await buildWorkbook(fakeDb(world()), findPreset("accountant-export"), FULL);
  const names = sheetNames(wb);
  assert.equal(names.length, 27, `expected 27 sheets, got ${names.length}: ${names.join(" | ")}`);
  assert.equal(new Set(names).size, 27, "sheet names must be unique");
  for (const n of names) assert.ok(n.length <= 31 && !/[*?:\\/[\]]/.test(n), `illegal Excel sheet name: ${n}`);
  assert.equal(names.filter((n) => n.startsWith("Monthly Income Report")).length, 12);
  assert.equal(names.filter((n) => n.startsWith("Monthly Expense Report")).length, 12);
  assert.deepEqual(names.slice(24), ["Yearly Income Report 2025", "Yearly Expense Report 2025", "P&L 2025"]);
  assert.ok(names.includes("Monthly Income Report Jan 2025"), `no January income sheet in ${names.join(" | ")}`);
});

// C1b — each monthly sheet is that month alone: the plan's ranges cover the year with no overlap or gap.
test("C1b the twelve monthly sheets cover the year, one calendar month each", () => {
  const plan = accountantPlan(YEAR);
  const income = plan.filter((p) => p.preset.key === "monthly-income").map((p) => p.range);
  assert.deepEqual(income[0], { start: "2025-01-01", end: "2025-01-31" });
  assert.deepEqual(income[1], { start: "2025-02-01", end: "2025-02-28" }, "February must end on the real last day");
  assert.deepEqual(income[11], { start: "2025-12-01", end: "2025-12-31" });
  assert.deepEqual(accountantPlan(2024)[1].range, { start: "2024-02-01", end: "2024-02-29" }, "leap February");
});

// C2 — a single report's export matches the on-screen panel to the cent, as NUMBERS with a currency format.
test("C2 expense export figures match the engine output to the cent, as formatted numbers", async () => {
  const preset = findPreset("monthly-expense");
  const expected = await runPreset(fakeDb(world()), preset, MARCH);
  const ws = (await buildWorkbook(fakeDb(world()), preset, MARCH)).worksheets[0];

  assert.deepEqual(ws.getRow(1).values.slice(1), ["Date", "Expense type", "Initials", "Description", "Reason", "Check #", "Amount"]);
  assert.ok(!/ExpDscr|FndsBranch/i.test(ws.getRow(1).values.join("|")), "legacy Access field names must not reach a header");

  expected.data.rows.forEach((r, i) => {
    const cell = ws.getRow(2 + i).getCell(7);
    assert.equal(typeof cell.value, "number", `row ${i} amount must be a number, got ${typeof cell.value}`);
    assert.equal(Math.round(cell.value * 100), r.amountCents, `row ${i} amount differs from the panel`);
    assert.ok(cell.numFmt, `row ${i} amount carries no currency format`);
  });
  const totalCell = ws.getRow(2 + expected.data.rows.length).getCell(7);
  assert.equal(Math.round(totalCell.value * 100), expected.data.totalCents);
  assert.equal(expected.data.total, "8.30", "fixture guard: March expenses are 8.29 + 0.01");
});

// C2b — the matrix keeps an untouched month blank; a 0 there would read as "we spent nothing", not "no data".
test("C2b a month the dimension never touched stays an empty cell, not zero", async () => {
  const preset = findPreset("yearly-expense");
  const expected = await runPreset(fakeDb(world()), preset, FULL);
  const ws = (await buildWorkbook(fakeDb(world()), preset, FULL)).worksheets[0];
  const row = ws.getRow(2 + expected.data.rows.findIndex((r) => r.key === "9"));
  assert.equal(row.getCell(1).value, "Active Type");
  assert.equal(Math.round(row.getCell(2).value * 100), 28, "January");         // 0.28
  assert.equal(row.getCell(3).value, null, "February is untouched and must be blank");
  assert.equal(Math.round(row.getCell(14).value * 100), expected.data.rows.find((r) => r.key === "9").totalCents);
});

// C3 — the export reads the same engine output the screen renders: it never writes, and the numbers it puts
// in the P&L are the engine's own cents, not a re-derivation.
test("C3 export is read-only and carries the engine's own P&L cents", async () => {
  const db = fakeDb(world());
  const preset = findPreset("pnl");
  const ws = (await buildWorkbook(db, preset, FULL)).worksheets[0];
  assert.equal(db.writes, 0, "the export issued a write");
  const expected = await runPreset(fakeDb(world()), preset, FULL);
  const at = (rowLabel, col) => ws.getRow(["Income", "Expenses", "Net", "Withdrawals"].indexOf(rowLabel) + 2).getCell(col);
  assert.equal(at("Income", 1).value, "Income");
  assert.equal(Math.round(at("Net", 4).value * 100), expected.data.months[2].netCents, "March net");
  assert.equal(Math.round(at("Withdrawals", 4).value * 100), expected.data.months[2].withdrawalsCents, "March withdrawals");
  assert.equal(Math.round(at("Income", 14).value * 100), expected.data.total.incomeCents, "year income total");
});

// C4 — the workbook actually serialises, and the filename is filesystem-safe.
test("C4 the workbook writes a non-trivial xlsx buffer and names its file safely", async () => {
  const wb = await buildWorkbook(fakeDb(world()), findPreset("accountant-export"), FULL);
  const buf = await wb.xlsx.writeBuffer();
  assert.ok(buf.byteLength > 5000, `xlsx buffer suspiciously small: ${buf.byteLength}`);
  assert.equal(Buffer.from(buf).subarray(0, 2).toString("latin1"), "PK", "not a zip container");
  assert.equal(workbookFilename(findPreset("accountant-export"), FULL), "accountant-export-2025.xlsx");
  assert.equal(workbookFilename(findPreset("monthly-expense"), MARCH), "monthly-expense-2025-03-01-to-2025-03-31.xlsx");
});
