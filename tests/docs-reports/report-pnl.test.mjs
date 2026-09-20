import test from "node:test";
import assert from "node:assert/strict";
import { fakeDb } from "./fakedb.mjs";

const { pnl } = await import("../../lib/reports/pnl.ts");
const { monthMatrix } = await import("../../lib/reports/matrix.ts");

// Fixture discipline (same as report-matrix.test.mjs): the base world holds only in-range, non-boundary rows,
// so boundary / as-of / leap-year signals are invisible to it and belong to the one test that pushes them.
//
// Every grouping key the engine uses has a COLLISION witness in the base world, so an accumulator mutant
// (`b[m] = (b[m] ?? 0) + c` -> `= c`) cannot survive: January carries 3 expense rows and 2 income rows,
// March carries 2 expense rows, 2 income rows and 2 withdrawal rows.
//
// Amounts are float-unfriendly (0.28 + 10.13 + 0.02, 8.29 + 0.01) so a float-sum mutant cannot land on the
// exact cent total by luck.

const exp = (expid, expdate, exptype, expamount, exp_notcountedinprofit = null) => ({
  expid, expdate, exptype, expamount, exp_notcountedinprofit,
  expcaseid: 55, expbranch: "Main", expdscr: `d${expid}`, expreason: null, expchecknum: null, expinit: 3,
});
const fnd = (fndsid, fndsdate, fndspmt) => ({
  fndsid, fndsdate, fndspmt, fndsbranch: "Main", fndscaseid: 55, fndspayee: "Acme", fndsdesc: `r${fndsid}`,
});

const world = () => ({
  tblexpenses: [
    exp(101, "2025-01-15", 9, 0.28),
    exp(102, "2025-01-20", 9, 10.13, 0),      // 0.00 is an AMOUNT of zero, not "false"
    exp(105, "2025-01-20", 9, 0.02),          // third January expense: accumulator witness
    exp(103, "2025-03-10", 6, 8.29, 1.5),
    exp(104, "2025-03-20", 6, 0.01, 2.5),     // second March withdrawal: accumulator witness
  ],
  tblfundsrcvd: [
    fnd(201, "2025-01-15", 0.28),
    fnd(202, "2025-01-20", 5.11),
    fnd(203, "2025-03-10", 7.0),
    fnd(204, "2025-03-20", 0.29),
  ],
  tblexptype: [
    { exptypeid: 9, exptype: "Alpha", active: true },
    { exptypeid: 6, exptype: "Beta", active: null },
  ],
});

// Jan: income 539, expenses 28+1013+2 = 1043, net -504, withdrawals 0
// Mar: income 729, expenses 829+1 = 830,     net -101, withdrawals 150+250 = 400
const JAN = { incomeCents: 539, expensesCents: 1043, netCents: -504, withdrawalsCents: 0 };
const MAR = { incomeCents: 729, expensesCents: 830, netCents: -101, withdrawalsCents: 400 };
const money = (m) => ({ incomeCents: m.incomeCents, expensesCents: m.expensesCents, netCents: m.netCents, withdrawalsCents: m.withdrawalsCents });

test("full year: twelve months, per-month income/expenses/net, a separate withdrawals row, and a Total For Year", async () => {
  const db = fakeDb(world());
  const r = await pnl(db, 2025);

  assert.equal(r.year, 2025);
  assert.equal(r.asOfMonth, 12);
  assert.equal(r.months.length, 12);
  assert.deepEqual(r.months.map((m) => m.month), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);

  assert.deepEqual(money(r.months[0]), JAN);
  assert.deepEqual(money(r.months[2]), MAR);
  // A quiet month is a real zero column, not a gap and not a carry-over of the previous month.
  assert.deepEqual(money(r.months[1]), { incomeCents: 0, expensesCents: 0, netCents: 0, withdrawalsCents: 0 });
  assert.deepEqual(money(r.months[11]), { incomeCents: 0, expensesCents: 0, netCents: 0, withdrawalsCents: 0 });

  assert.equal(r.total.label, "Total For Year");
  assert.deepEqual(money(r.total), { incomeCents: 1268, expensesCents: 1873, netCents: -605, withdrawalsCents: 400 });
  // Formatted strings track the cents, including the negative net.
  assert.deepEqual(
    { income: r.total.income, expenses: r.total.expenses, net: r.total.net, withdrawals: r.total.withdrawals },
    { income: "12.68", expenses: "18.73", net: "-6.05", withdrawals: "4.00" },
  );
  assert.equal(db.writes, 0);
});

test("net is income minus expenses in every column, and the total is the sum of the columns", async () => {
  const db = fakeDb(world());
  const r = await pnl(db, 2025);
  const sum = { incomeCents: 0, expensesCents: 0, netCents: 0, withdrawalsCents: 0 };
  for (const m of r.months) {
    assert.equal(m.netCents, m.incomeCents - m.expensesCents, `month ${m.month}`);
    for (const k of Object.keys(sum)) sum[k] += m[k];
  }
  assert.deepEqual(money(r.total), sum);
});

test("exp_notcountedinprofit is a dollar amount, never coerced to a boolean", async () => {
  // Three rows identical but for the column: NULL, 0.00, and 1500.00, in three different months.
  // A truthiness mutant (`x ? 1 : 0`, or `toCents(Boolean(x))`) reports 1 cent, not 150000, for May.
  const t = world();
  t.tblexpenses = [
    exp(301, "2025-04-10", 9, 20.0, null),
    exp(302, "2025-05-10", 9, 20.0, 1500.0),
    exp(303, "2025-06-10", 9, 20.0, 0),
  ];
  t.tblfundsrcvd = [];
  const r = await pnl(fakeDb(t), 2025);

  assert.deepEqual(r.months.slice(3, 6).map((m) => m.withdrawalsCents), [0, 150_000, 0]);
  assert.equal(r.months[4].withdrawals, "1,500.00");
  assert.equal(r.total.withdrawalsCents, 150_000);
  // The column never leaks into the expense line: three identical 20.00 expenses, three identical columns.
  assert.deepEqual(r.months.slice(3, 6).map((m) => m.expensesCents), [2000, 2000, 2000]);
  assert.deepEqual(r.months.slice(3, 6).map((m) => m.netCents), [-2000, -2000, -2000]);
});

test("withdrawals are a memo row: changing a withdrawal amount moves nothing but the withdrawals row", async () => {
  const base = await pnl(fakeDb(world()), 2025);

  const t = world();
  t.tblexpenses[3].exp_notcountedinprofit = 99.99; // was 1.50
  t.tblexpenses[4].exp_notcountedinprofit = 0;     // was 2.50
  const moved = await pnl(fakeDb(t), 2025);

  const line = (r) => r.months.map((m) => [m.incomeCents, m.expensesCents, m.netCents]);
  assert.deepEqual(line(moved), line(base), "income/expenses/net must not depend on exp_notcountedinprofit");
  assert.equal(moved.total.expensesCents, base.total.expensesCents);
  assert.equal(moved.total.netCents, base.total.netCents);
  // ...and the withdrawals row alone did move, so the fixture really exercised the column.
  assert.equal(base.total.withdrawalsCents, 400);
  assert.equal(moved.total.withdrawalsCents, 9999);
});

test("expenses year total equals the month-matrix exptype year total, to the cent", async () => {
  const t = world(); // carries withdrawals on purpose: the two engines must still agree
  const [p, m] = await Promise.all([pnl(fakeDb(t), 2025), monthMatrix(fakeDb(t), 2025, "exptype")]);
  assert.equal(p.total.expensesCents, m.totals.totalCents);
  assert.equal(p.total.expenses, m.totals.total);
  // Per-month too, so an offsetting pair of month errors cannot hide inside an equal year total.
  assert.deepEqual(p.months.map((x) => x.expensesCents), m.totals.cells.map((c) => c.cents ?? 0));
});

test("an as-of month truncates the result; it never zero-fills the remaining months", async () => {
  const t = world();
  t.tblexpenses.push(exp(401, "2025-04-05", 9, 500.0, 77.0)); // April: must not appear at all
  t.tblfundsrcvd.push(fnd(401, "2025-04-05", 900.0));

  const r = await pnl(fakeDb(t), 2025, 3);
  assert.equal(r.asOfMonth, 3);
  assert.equal(r.months.length, 3, "three entries, not twelve with nine zeros");
  assert.deepEqual(r.months.map((m) => m.month), [1, 2, 3]);
  assert.equal(r.months.find((m) => m.month > 3), undefined);

  // The year total covers the elapsed months only — April's 900.00 / 500.00 / 77.00 are absent from it.
  assert.deepEqual(money(r.total), { incomeCents: 1268, expensesCents: 1873, netCents: -605, withdrawalsCents: 400 });
  const full = await pnl(fakeDb(t), 2025);
  assert.equal(full.months.length, 12);
  assert.equal(full.total.incomeCents, 1268 + 90_000, "the same fixture at full year DOES include April");
});

test("date bounds are inclusive at both ends, and the as-of end is the last day of that month", async () => {
  const t = world();
  t.tblexpenses.push(
    exp(501, "2024-12-31", 9, 1000.0),  // prior year, out
    exp(502, "2025-01-01", 9, 0.05),    // lower bound, in
    exp(503, "2025-12-31", 9, 0.07),    // upper bound, in
    exp(504, "2026-01-01", 9, 2000.0),  // next year, out
  );
  // Income has its own date filter and its own witnesses at both bounds.
  t.tblfundsrcvd.push(
    fnd(511, "2024-12-31", 3000.0),
    fnd(512, "2025-01-01", 0.11),
    fnd(513, "2025-12-31", 0.13),
    fnd(514, "2026-01-01", 4000.0),
  );
  const r = await pnl(fakeDb(t), 2025);
  assert.equal(r.months[0].expensesCents, JAN.expensesCents + 5);
  assert.equal(r.months[11].expensesCents, 7);
  assert.equal(r.total.expensesCents, 1873 + 5 + 7);
  assert.equal(r.months[0].incomeCents, JAN.incomeCents + 11);
  assert.equal(r.months[11].incomeCents, 13);
  assert.equal(r.total.incomeCents, 1268 + 11 + 13);

  // As-of 3: the last day of March is in, the first day of April is out.
  const u = world();
  u.tblexpenses.push(exp(505, "2025-03-31", 6, 0.03), exp(506, "2025-04-01", 6, 4000.0));
  u.tblfundsrcvd.push(fnd(515, "2025-03-31", 0.04), fnd(516, "2025-04-01", 5000.0));
  const q = await pnl(fakeDb(u), 2025, 3);
  assert.equal(q.months[2].expensesCents, MAR.expensesCents + 3);
  assert.equal(q.total.expensesCents, 1873 + 3);
  assert.equal(q.months[2].incomeCents, MAR.incomeCents + 4);
  assert.equal(q.total.incomeCents, 1268 + 4);
});

test("an out-of-range as-of month is clamped into 1..12", async () => {
  const t = world();
  t.tblexpenses.push(exp(801, "2026-01-09", 9, 6000.0)); // next January: a 13th column would swallow it
  assert.equal((await pnl(fakeDb(t), 2025, 13)).months.length, 12);
  assert.equal((await pnl(fakeDb(t), 2025, 13)).total.expensesCents, 1873);
  assert.equal((await pnl(fakeDb(t), 2025, 0)).months.length, 1);
  assert.equal((await pnl(fakeDb(t), 2025, 0)).total.expensesCents, JAN.expensesCents);
});

test("as-of on a leap February ends on the 29th", async () => {
  const t = { tblexpenses: [exp(601, "2024-02-29", 9, 1.11), exp(602, "2024-03-01", 9, 5000.0)], tblfundsrcvd: [], tblexptype: [] };
  const r = await pnl(fakeDb(t), 2024, 2);
  assert.equal(r.months.length, 2);
  assert.equal(r.total.expensesCents, 111);
});

test("no string field anywhere in the result is Null, NaN or undefined", async () => {
  const t = world();
  t.tblexpenses.push(exp(701, "2025-08-08", null, 0.09, null)); // untyped expense, null withdrawal
  const r = await pnl(fakeDb(t), 2025);
  const bad = [];
  // Walks EVERY string-bearing field generically — months, total, labels, formatted amounts alike.
  const walk = (v, path) => {
    if (typeof v === "string") { if (/null|nan|undefined/i.test(v)) bad.push(`${path}=${v}`); return; }
    if (typeof v === "number") { if (!Number.isFinite(v)) bad.push(`${path}=${v}`); return; }
    if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) walk(x, `${path}.${k}`);
  };
  walk(r, "pnl");
  assert.deepEqual(bad, []);
});

test("the engine is read-only and pages past PostgREST's 1000-row cap", async () => {
  const t = { tblexpenses: [], tblfundsrcvd: [], tblexptype: [] };
  for (let i = 1; i <= 2500; i += 1) t.tblexpenses.push(exp(i, "2025-02-02", 9, 0.01, 0.01));
  for (let i = 1; i <= 1300; i += 1) t.tblfundsrcvd.push(fnd(i, "2025-02-02", 0.02));
  const db = fakeDb(t);
  const r = await pnl(db, 2025);
  assert.equal(r.months[1].expensesCents, 2500);
  assert.equal(r.months[1].withdrawalsCents, 2500);
  assert.equal(r.months[1].incomeCents, 2600);
  assert.equal(db.writes, 0);
});

test("the as-of month narrows the QUERY, not just the in-memory fold", async () => {
  // Owns one thing: that `end` is the last day of the as-of month in the SQL, not December 31st.
  // Output cannot see the difference — later rows are folded away either way — so this observes the READ.
  // `pageAll` is count-first: one read while the count fits in PostgREST's 1000-row page, two once it does not.
  // 1,500 December rows sit outside a correctly-bounded Q1 query and inside a year-bounded one.
  const t = { tblexpenses: [exp(1, "2025-02-02", 9, 1.0)], tblfundsrcvd: [fnd(1, "2025-02-02", 1.0)], tblexptype: [] };
  for (let i = 2; i <= 1501; i += 1) t.tblexpenses.push(exp(i, "2025-12-15", 9, 1.0));

  const db = fakeDb(t);
  const r = await pnl(db, 2025, 3);
  // One page of tblexpenses (1 Q1 row) + one page of tblfundsrcvd. A year-wide expense query needs a second page.
  assert.equal(db.reads, 2, "as-of 3 must not read December's rows at all");
  assert.equal(r.total.expensesCents, 100);

  // Control: the same fixture at full year really does cost the extra page, so `reads` is discriminating here.
  const full = fakeDb(t);
  await pnl(full, 2025);
  assert.equal(full.reads, 3);
  assert.equal((await pnl(fakeDb(t), 2025)).total.expensesCents, 150_100);
});
