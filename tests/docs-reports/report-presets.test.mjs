import test from "node:test";
import assert from "node:assert/strict";
import { fakeDb } from "./fakedb.mjs";

const { PRESETS, findPreset, isDate, isRange, runPreset, yearOf } = await import("../../lib/reports/presets.ts");

const exp = (expid, expdate, expamount, exptype = 9, expdscr = `d${expid}`) => ({
  expid, expdate, exptype, expamount, expdscr,
  expcaseid: 55, expbranch: "Main", expreason: null, expchecknum: null, expinit: 3, exp_notcountedinprofit: null,
});
const fnd = (fndsid, fndsdate, fndspmt, fndsdesc = `r${fndsid}`) => ({
  fndsid, fndsdate, fndspmt, fndsdesc, fndsbranch: "Main", fndscaseid: 55, fndspayee: "Acme",
});

// Witnesses sit at BOTH ends of the range and one day outside each end, so a widened or shifted bound
// changes the output in a way a value assertion can see.
const world = () => ({
  tblexpenses: [
    exp(1, "2024-12-31", 100.0),           // before the year and before the range
    exp(2, "2025-01-01", 0.28),            // range start, year start
    exp(3, "2025-03-20", 0.01, 9, "Consultant fee"),
    exp(4, "2025-06-30", 8.29),            // range end
    exp(5, "2025-07-01", 500.0),           // one day after the range, still in the year
    exp(6, "2025-12-31", 0.01),            // year end
    exp(7, "2026-01-01", 900.0),           // after the year
  ],
  tblfundsrcvd: [
    fnd(1, "2024-12-31", 70.0),
    fnd(2, "2025-01-01", 1.11),
    fnd(3, "2025-06-30", 2.22, "Consultant retainer"),
    fnd(4, "2025-07-01", 300.0),
    fnd(5, "2025-12-31", 3.33),
    fnd(6, "2026-01-01", 800.0),
  ],
  tblexptype: [{ exptypeid: 9, exptype: "Alpha", active: true }],
  tblbillingnames: [{ personid: 3, initials: "KP" }],
  tblcase: [{ caseid: 55, caseatty: 7 }],
  tblattorney: [{ attyid: 7, attylastname: "Ray", attyfirstname: "Jon" }],
});

const RANGE = { start: "2025-01-01", end: "2025-06-30" };

// --- the preset table itself ---------------------------------------------------------------------

test("every preset key is unique and resolvable", () => {
  const keys = PRESETS.map((p) => p.key);
  assert.equal(new Set(keys).size, keys.length);
  for (const k of keys) assert.equal(findPreset(k)?.key, k);
  assert.equal(findPreset("no-such-preset"), undefined);
  assert.equal(findPreset(""), undefined);
});

test("the six legacy report names are present and journey 06's three selectors each match exactly one button", () => {
  const labels = PRESETS.map((p) => p.label);
  for (const want of ["Monthly Expense Report", "Monthly Income Report", "Yearly Expense Report", "Yearly Income Report", "P&L"]) {
    assert.ok(labels.includes(want), `missing preset: ${want}`);
  }
  for (const rx of [/p&l|profit/i, /yearly ?expense/i, /accountant export/i]) {
    assert.equal(labels.filter((l) => rx.test(l)).length, 1, `${rx} must match exactly one button label`);
  }
  // A filtered-expense cut exists: an expenseDetail row carrying a description filter.
  const filtered = PRESETS.filter((p) => p.engine === "expenseDetail" && p.params(RANGE).description);
  assert.equal(filtered.length, 1);
});

// --- parameter derivation: what the page HANDS the engine ----------------------------------------

test("detail and P&L presets pass the submitted range verbatim; yearly presets pass the start date's year", () => {
  for (const p of PRESETS) {
    const a = p.params(RANGE);
    if (p.engine === "expenseDetail" || p.engine === "incomeDetail" || p.engine === "pnl") {
      assert.equal(a.start, RANGE.start);
      assert.equal(a.end, RANGE.end);
    } else {
      assert.equal(a.year, 2025);
      assert.equal(yearOf(RANGE), 2025);
    }
    if (p.engine === "matrix") assert.ok(a.dimension === "exptype" || a.dimension === "branch");
  }
});

test("date validation rejects shape, calendar and order failures", () => {
  assert.ok(isDate("2025-06-30"));
  assert.ok(isDate("2024-02-29"));
  assert.equal(isDate("2025-02-31"), false);
  assert.equal(isDate("2025-13-01"), false);
  assert.equal(isDate("06/30/2025"), false);
  assert.equal(isDate(""), false);
  assert.ok(isRange(RANGE));
  assert.ok(isRange({ start: "2025-01-01", end: "2025-01-01" }));
  assert.equal(isRange({ start: "2025-06-30", end: "2025-01-01" }), false);
  assert.equal(isRange({ start: "2025-01-01", end: "" }), false);
});

// --- what actually gets READ ----------------------------------------------------------------------

test("a detail preset reads only the submitted range — both out-of-range witnesses stay out", async () => {
  const db = fakeDb(world());
  const { engine, data } = await runPreset(db, findPreset("monthly-expense"), RANGE);
  assert.equal(engine, "expenseDetail");
  assert.deepEqual(data.rows.map((r) => r.expid), [2, 3, 4]);
  assert.equal(data.total, "8.58"); // 0.28 + 0.01 + 8.29 — the 100.00 and 500.00 witnesses are excluded
  assert.equal(db.writes, 0);
});

test("a yearly preset reads the whole calendar year, not the submitted range", async () => {
  const db = fakeDb(world());
  const { engine, data } = await runPreset(db, findPreset("yearly-expense"), RANGE);
  assert.equal(engine, "matrix");
  assert.equal(data.year, 2025);
  // 2025-07-01 (500.00) is outside the submitted range but inside the year: it must appear, in July.
  const total = data.totals;
  assert.equal(total.cells[6].amount, "500.00");
  assert.equal(total.cells[11].amount, "0.01"); // 2025-12-31, the far end of the year
  assert.equal(total.total, "508.59");
  assert.equal(db.writes, 0);
});

test("the P&L preset covers exactly the submitted range: one column per month touched, only in-range rows", async () => {
  const db = fakeDb(world());
  const { engine, data } = await runPreset(db, findPreset("pnl"), RANGE);
  assert.equal(engine, "pnl");
  assert.equal(data.months.length, 6);
  assert.deepEqual(data.months.map((m) => m.month), [1, 2, 3, 4, 5, 6]);
  assert.equal(data.total.expenses, "8.58"); // 0.28 + 0.01 + 8.29; the 500.00 on 07-01 is out of range
  assert.equal(data.total.income, "3.33"); // 1.11 + 2.22; the 300.00 on 07-01 is out of range
  assert.equal(data.total.net, "-5.25");
  assert.equal(db.writes, 0);
});

test("the accountant-export preset still produces a rendered result this step", async () => {
  const db = fakeDb(world());
  const p = findPreset("accountant-export");
  assert.match(p.label, /accountant export/i);
  assert.ok(p.note && p.note.length > 0, "an inert preset must say why");
  const { data } = await runPreset(db, p, RANGE);
  assert.equal(data.months.length, 6);
});

test("the filtered-expense preset narrows by description without touching the range", async () => {
  const db = fakeDb(world());
  const p = PRESETS.find((x) => x.engine === "expenseDetail" && x.params(RANGE).description);
  const { data } = await runPreset(db, p, RANGE);
  assert.deepEqual(data.rows.map((r) => r.expid), [3]);
  assert.equal(data.total, "0.01");
});

// --- structural invariant the page renders straight into the DOM ----------------------------------

test("no preset result carries the string Null or undefined in any string-bearing field", async () => {
  const bad = /^(null|undefined)$/i;
  const walk = (v, path) => {
    if (typeof v === "string") { assert.equal(bad.test(v), false, `${path} rendered as "${v}"`); return; }
    if (Array.isArray(v)) { v.forEach((x, i) => walk(x, `${path}[${i}]`)); return; }
    if (v && typeof v === "object") { for (const [k, x] of Object.entries(v)) walk(x, `${path}.${k}`); }
  };
  // A quiet month in a sparse year is the case that produced the legacy "Null" cell.
  const sparse = world();
  for (const p of PRESETS) {
    const db = fakeDb(structuredClone(sparse));
    const { data } = await runPreset(db, p, RANGE);
    walk(data, p.key);
  }
});

test("an untouched month is a blank cell, not a zero and not a placeholder", async () => {
  const db = fakeDb({ ...world(), tblfundsrcvd: [fnd(9, "2025-04-10", 5.0)] });
  const { data } = await runPreset(db, findPreset("yearly-income"), RANGE);
  const row = data.rows[0];
  assert.equal(row.cells.length, 12);
  assert.equal(row.cells[3].amount, "5.00");
  assert.equal(row.cells[3].cents, 500);
  for (const i of [0, 11]) {
    assert.equal(row.cells[i].amount, "");
    assert.equal(row.cells[i].cents, null);
  }
  assert.equal(row.total, "5.00");
});
