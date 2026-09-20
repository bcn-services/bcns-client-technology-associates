import test from "node:test";
import assert from "node:assert/strict";
import { fakeDb } from "./fakedb.mjs";

const { monthMatrix } = await import("../../lib/reports/matrix.ts");

// Fixture discipline: every criterion below owns EXACTLY ONE signal. The base world carries only in-range rows
// of ACTIVE types on non-boundary dates, so a retired-type mutant, a boundary mutant and a paging mutant are all
// invisible to it — each of those rows is pushed by the single test that is about them and by no other.

const exp = (expid, expdate, exptype, expamount) => ({
  expid, expdate, exptype, expamount,
  expcaseid: 55, expbranch: "Main", expdscr: `d${expid}`, expreason: null, expchecknum: null, expinit: 3,
});
const fnd = (fndsid, fndsdate, fndsbranch, fndspmt) => ({
  fndsid, fndsdate, fndsbranch, fndspmt, fndscaseid: 55, fndspayee: "Acme", fndsdesc: `r${fndsid}`,
});

// Amounts are float-unfriendly on purpose: 0.28 + 0.01 and 8.29 + 0.01 do not re-associate cleanly as doubles,
// so a float-sum mutant cannot land on the exact cent total by luck.
const world = () => ({
  tblexpenses: [
    exp(101, "2025-01-15", 9, 0.28),
    exp(102, "2025-03-20", 9, 0.01),
    exp(103, "2025-03-20", 6, 8.29),
    exp(104, "2025-07-04", 6, 0.01),
  ],
  tblexptype: [
    { exptypeid: 9, exptype: "Alpha", active: true },
    { exptypeid: 6, exptype: "Beta", active: true },
    { exptypeid: 7, exptype: "Retired Null", active: null },
    { exptypeid: 8, exptype: "Retired False", active: false },
    { exptypeid: 5, exptype: "Edge", active: true },
    { exptypeid: 4, exptype: "PriorEdge", active: true },
    { exptypeid: 3, exptype: "NextEdge", active: true },
    { exptypeid: 2, exptype: "StartEdge", active: true },
  ],
  tblfundsrcvd: [
    fnd(201, "2025-02-10", "Main", 0.28),
    fnd(202, "2025-05-10", "Main", 0.01),
    fnd(203, "2025-06-10", "Second", 8.29),
  ],
});

const row = (m, key) => m.rows.find((r) => r.key === key);

// M1 — the legacy form prints `Null` for an untouched month; this engine must print nothing, in ANY
// rendered field. The walk is generic over every string the engine emits (`label`, `total`, each
// `cells[].amount`, and anything added to MatrixRow later) — `key` alone is excluded because it is an
// internal identifier, not a cell, and "null" is its legitimate value for an untyped expense.
// No other test asserts an exact `amount`, `total` or `label` string, so a "Null"-emitting mutant in any
// of them can only be seen here.
const strings = (v, path, out) => {
  if (typeof v === "string") out.push([path, v]);
  else if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) if (k !== "key") strings(x, `${path}.${k}`, out);
  return out;
};

test("untouched months are empty and no rendered string anywhere is Null", async () => {
  const m = await monthMatrix(fakeDb(world()), 2025, "exptype");
  const feb = row(m, "9").cells[1];
  assert.deepEqual(feb, { cents: null, amount: "" }, "an untouched month must be cents:null / amount:''");
  const seen = [...m.rows, m.totals].flatMap((r) => strings(r, r.key, []));
  // The walk is only a guard if it actually reaches the three rendered field kinds; a field that stops
  // being walked (renamed, nested deeper) must break this, not silently shrink the guard.
  for (const suffix of [".label", ".total", ".cells.0.amount"])
    assert.ok(seen.some(([p]) => p.endsWith(suffix)), `the no-Null walk never reached a ${suffix} field`);
  for (const [path, value] of seen)
    assert.ok(!/null/i.test(value), `${path} rendered ${JSON.stringify(value)}`);
});

// M2 — `tblexptype.active` is nullable and gates the picker, never the report. Both flavours of retired
// (active null, active false) exist ONLY in this test, so filtering them out is invisible to every other test.
// Subject is ROW PRESENCE (the guardrail) plus the fact that a name was resolved at all — deliberately not an
// exact label string, which would make this a second oracle for the no-Null walk above.
test("retired expense types (active null and active false) still get a row", async () => {
  const w = world();
  w.tblexpenses.push(exp(108, "2025-04-10", 7, 1.0), exp(109, "2025-04-10", 8, 1.0));
  const m = await monthMatrix(fakeDb(w), 2025, "exptype");
  assert.deepEqual(
    [row(m, "7"), row(m, "8")].map((r) => r && r.key),
    ["7", "8"],
    "a retired expense type with activity in the year lost its row",
  );
  for (const k of ["7", "8"])
    assert.ok(row(m, k).label !== "" && !row(m, k).label.startsWith("#"), `retired type ${k} fell back to an unresolved label`);
});

// M3 — branches are folded from the rows in range, never zero-filled from the table. "Quiet" banks only
// outside the year and exists ONLY here.
test("branch dimension returns one row per branch in range and no row for a branch that is quiet all year", async () => {
  const w = world();
  w.tblfundsrcvd.push(fnd(204, "2024-06-10", "Quiet", 500.0));
  const m = await monthMatrix(fakeDb(w), 2025, "branch");
  assert.deepEqual(m.rows.map((r) => r.key), ["Main", "Second"], "branch rows must be exactly the branches with activity in 2025");
});

// M4 — money is summed as integer cents, and both folds accumulate rather than overwrite. Two type-9 rows
// share March (so the per-(row,month) accumulator is exercised) and types 9 and 6 both land in March (so the
// column fold is exercised across dimension values). Those two same-cell rows live ONLY in this test.
// 0.28 + (0.01 + 0.28) + 8.29 + 0.01 = 8.87 -> 887 cents; float-unfriendly on purpose, and compared against an
// integer, so a double sum can never land on it.
test("row year totals and month-column totals fold to the same exact grand total", async () => {
  const w = world();
  w.tblexpenses.push(exp(110, "2025-03-21", 9, 0.28)); // second type-9 row in March: the accumulator's only witness
  const m = await monthMatrix(fakeDb(w), 2025, "exptype");
  const fromRows = m.rows.reduce((s, r) => s + r.totalCents, 0);
  const fromColumns = m.totals.cells.reduce((s, c) => s + (c.cents ?? 0), 0);
  assert.equal(fromRows, 887, "sum of per-row year totals");
  assert.equal(fromColumns, 887, "sum of the twelve month-column totals");
  assert.equal(m.totals.totalCents, 887, "totals row year total");
  assert.equal(row(m, "9").cells[2].cents, 29, "March for type 9 must be 0.01 + 0.28, not one row overwriting the other");
  assert.equal(m.totals.cells[2].cents, 858, "the March column must be type 9 + type 6, not one overwriting the other");
});

// M5 — PostgREST caps a read at 1000 rows; the engine pages. Row 1201 is the only "Deep" row and sits past
// the first page, so it is reachable only if every page was read.
test("reads past the first 1000-row page", async () => {
  const w = world();
  w.tblfundsrcvd = [];
  for (let i = 1; i <= 1200; i += 1) w.tblfundsrcvd.push(fnd(1000 + i, "2025-01-05", "Bulk", 1.0));
  w.tblfundsrcvd.push(fnd(2999, "2025-11-05", "Deep", 1.0));
  const m = await monthMatrix(fakeDb(w), 2025, "branch");
  assert.ok(row(m, "Deep"), "the branch seeded at table position 1201 was never read — paging stopped at page 1");
});

// M6 / P4 — the year is [yyyy-01-01, yyyy-12-31] INCLUSIVE, and there are FOUR endpoints to witness:
// expdate start/end and fndsdate start/end. Each in-range boundary row carries its own dimension key
// (types 2 and 5; branches BStart and BEnd), so a shifted endpoint shows up as a row APPEARING or
// VANISHING and never as a changed amount — that is what keeps this test from doubling as an oracle for
// the cent-sum guard. Assertions are on keys and on which months are non-empty; never on a cent value,
// an amount string or a label, so M1/M2/M4/N1-N4 are all invisible here.
//
// Both dimensions live in ONE test on purpose: `start`/`end` are shared by the two queries, so splitting
// them would make a single shift of either constant kill two tests, which is exactly the shared-oracle
// shape we are avoiding. The subject is one criterion — "the four inclusive endpoints".
//
// The out-of-range probes are expense rows only (types 4 and 3). Deliberately NO out-of-range BRANCH row:
// that would make the zero-fill mutant (M3) kill this test as well as the branch-rows test.
test("all four year endpoints are inclusive and adjacent years do not leak in", async () => {
  const w = world();
  w.tblexpenses.push(
    exp(111, "2025-01-01", 2, 2.0), // lower endpoint, in range
    exp(105, "2025-12-31", 5, 5.0), // upper endpoint, in range
    exp(106, "2024-12-31", 4, 3.0), // one day before, out
    exp(107, "2026-01-01", 3, 7.0), // one day after, out
  );
  w.tblfundsrcvd.push(fnd(301, "2025-01-01", "BStart", 1.0), fnd(302, "2025-12-31", "BEnd", 1.0));

  const m = await monthMatrix(fakeDb(w), 2025, "exptype");
  const months = (r) => r.cells.map((c, i) => (c.cents == null ? -1 : i)).filter((i) => i >= 0);
  assert.ok(row(m, "2"), "the 2025-01-01 expense fell outside the year — the lower bound is exclusive");
  assert.ok(row(m, "5"), "the 2025-12-31 expense fell outside the year — the upper bound is exclusive");
  assert.deepEqual(months(row(m, "2")), [0], "the 2025-01-01 row must land in January and nowhere else");
  assert.deepEqual(months(row(m, "5")), [11], "the 2025-12-31 row must land in December and nowhere else");
  assert.deepEqual([row(m, "4"), row(m, "3")], [undefined, undefined], "an adjacent year's boundary day leaked into 2025");

  const b = await monthMatrix(fakeDb(w), 2025, "branch");
  assert.ok(row(b, "BStart"), "the 2025-01-01 receipt fell outside the year — fndsdate's lower bound is exclusive");
  assert.ok(row(b, "BEnd"), "the 2025-12-31 receipt fell outside the year — fndsdate's upper bound is exclusive");
});

// M7 — read-only, proved by driving the real engine against a fake that counts write statements.
test("the engine issues no writes", async () => {
  const db = fakeDb(world());
  await monthMatrix(db, 2025, "exptype");
  await monthMatrix(db, 2025, "branch");
  assert.equal(db.writes, 0, "the month-matrix engine must be read-only");
});
