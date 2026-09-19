// The `/reports` page itself: what reaches the DOM, that one panel is reused by every preset, and that the
// figures on screen are the engine's own output. Renders the real server component (see ./render.mjs).
import test from "node:test";
import assert from "node:assert/strict";
import { fakeDb } from "./fakedb.mjs";
import { render, panel, texts, tableRows, pageModule, session, dbclient } from "./render.mjs";

const { PRESETS, runPreset, findPreset } = await import("../../lib/reports/presets.ts");
const { pnl } = await import("../../lib/reports/pnl.ts");
const { monthMatrix } = await import("../../lib/reports/matrix.ts");

const START = "2026-01-01";
const END = "2026-06-30";
const RANGE = { start: START, end: END };
const q = (preset) => ({ start: START, end: END, preset });

// Nullable columns are null on at least one row of every table, and every grouping key has two colliding
// rows, so an accumulator and a null-rendering path both have a witness. Witnesses sit at both ends of the
// submitted range, both ends of the calendar year, and one day outside each.
const world = () => ({
  tblexpenses: [
    { expid: 1, expdate: "2025-12-31", exptype: 9, expinit: 3, expdscr: "prior year", expreason: "r", expchecknum: 11, expamount: 400.0, expbranch: "Main" },
    { expid: 2, expdate: "2026-01-01", exptype: 9, expinit: 3, expdscr: "Consultant retainer", expreason: null, expchecknum: null, expamount: 0.28, expbranch: "Main" },
    { expid: 3, expdate: "2026-01-15", exptype: 9, expinit: 3, expdscr: null, expreason: null, expchecknum: null, expamount: 0.03, expbranch: "Main" },
    { expid: 4, expdate: "2026-06-30", exptype: null, expinit: null, expdscr: null, expreason: null, expchecknum: null, expamount: 8.29, expbranch: "Main" },
    { expid: 5, expdate: "2026-07-01", exptype: 9, expinit: 3, expdscr: "after the range", expreason: null, expchecknum: null, expamount: 500.0, expbranch: "Main" },
    { expid: 6, expdate: "2026-12-31", exptype: 9, expinit: 3, expdscr: "year end", expreason: null, expchecknum: null, expamount: 0.01, expbranch: "Main" },
    { expid: 7, expdate: "2027-01-01", exptype: 9, expinit: 3, expdscr: "next year", expreason: null, expchecknum: null, expamount: 900.0, expbranch: "Main" },
  ],
  tblfundsrcvd: [
    { fndsid: 1, fndsdate: "2025-12-31", fndspmt: 70.0, fndsdesc: "prior", fndsbranch: "North", fndscaseid: 55, fndspayee: "Acme" },
    { fndsid: 2, fndsdate: "2026-01-01", fndspmt: 1.11, fndsdesc: null, fndsbranch: "North", fndscaseid: 55, fndspayee: null },
    { fndsid: 3, fndsdate: "2026-01-20", fndspmt: 2.22, fndsdesc: "Consultant retainer", fndsbranch: "North", fndscaseid: null, fndspayee: "Acme" },
    { fndsid: 4, fndsdate: "2026-06-30", fndspmt: 3.33, fndsdesc: null, fndsbranch: null, fndscaseid: 55, fndspayee: null },
    { fndsid: 5, fndsdate: "2026-07-01", fndspmt: 300.0, fndsdesc: "after the range", fndsbranch: "North", fndscaseid: 55, fndspayee: "Acme" },
    { fndsid: 6, fndsdate: "2026-12-31", fndspmt: 4.44, fndsdesc: "year end", fndsbranch: "North", fndscaseid: 55, fndspayee: "Acme" },
    { fndsid: 7, fndsdate: "2027-01-01", fndspmt: 800.0, fndsdesc: "next year", fndsbranch: "North", fndscaseid: 55, fndspayee: "Acme" },
  ],
  tblexptype: [{ exptypeid: 9, exptype: "Alpha", active: true }],
  tblbillingnames: [{ personid: 3, initials: "KP" }],
  tblcase: [{ caseid: 55, caseatty: 7 }],
  tblattorney: [{ attyid: 7, attylastname: "Ray", attyfirstname: "Jon" }],
});

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

test.beforeEach(() => { session.state.calls = 0; session.state.redirect = false; dbclient.state.calls = 0; });

// --- criterion 1: P&L renders twelve month columns and a year total -------------------------------

test("filling both dates and choosing P&L renders a non-empty panel with twelve month columns and a year total", async () => {
  const markup = await render(fakeDb(world()), q("pnl"));
  const body = panel(markup);
  assert.ok(texts(body).length > 2, "panel must not be empty");
  for (const m of MONTHS) assert.ok(new RegExp(`>${m}<`).test(body), `missing month column ${m}`);
  assert.match(body, /data-testid="report-total"/);
  const want = await pnl(fakeDb(world()), 2026, 12);
  assert.equal(want.months.length, 12);
  assert.match(body, new RegExp(`data-testid="report-total"[^>]*>${want.total.net.replace("-", "-")}<`));
  for (const row of ["Income", "Expenses", "Net", "Withdrawals"]) assert.ok(body.includes(`>${row}<`), `missing line ${row}`);
});

// --- criterion 2: one panel, reused --------------------------------------------------------------

test("every preset renders into the same single report-results panel, replacing what was there", async () => {
  assert.equal(PRESETS.length >= 6, true, "six familiar legacy names plus the export row");
  const seen = new Map();
  for (const p of PRESETS) {
    const markup = await render(fakeDb(world()), q(p.key));
    const body = panel(markup); // throws unless there is exactly ONE panel in the whole document
    assert.ok(texts(body).length > 1, `${p.key} rendered an empty panel`);
    assert.ok(texts(body).some((t) => t.startsWith(p.label)), `${p.key} panel is not captioned with its own name`);
    if (p.note) assert.ok(texts(body).includes(p.note), `${p.key} declares a note the panel never shows`);
    seen.set(p.key, body);
  }
  // The panel is repopulated, not appended to: no preset's panel is a superset of another's rows.
  const pnlBody = seen.get("pnl");
  const detailBody = seen.get("monthly-expense");
  assert.notEqual(pnlBody, detailBody);
  assert.equal(pnlBody.includes("Consultant retainer"), false, "the P&L panel still carries the previous report's rows");
  assert.equal(detailBody.includes(">Withdrawals<"), false, "the detail panel still carries the P&L's rows");
});

// --- criterion 3: the figures on screen are the engine's own output -------------------------------

test("every money figure on screen is exactly what the engine returned, to two decimals", async () => {
  for (const p of PRESETS) {
    const body = panel(await render(fakeDb(world()), q(p.key)));
    const shown = texts(body).filter((t) => /^-?\d+\.\d+$/.test(t));
    assert.ok(shown.length > 0, `${p.key} showed no figures`);
    for (const t of shown) assert.match(t, /^-?\d+\.\d{2}$/, `${p.key} showed "${t}", not two decimals`);
    const { data } = await runPreset(fakeDb(world()), p, RANGE);
    const fromEngine = new Set();
    const collect = (v) => {
      if (typeof v === "string") { if (/^-?\d+\.\d{2}$/.test(v)) fromEngine.add(v); return; }
      if (Array.isArray(v)) { v.forEach(collect); return; }
      if (v && typeof v === "object") Object.values(v).forEach(collect);
    };
    collect(data);
    for (const t of shown) assert.ok(fromEngine.has(t), `${p.key} shows ${t}, which the engine never returned`);
    for (const t of fromEngine) assert.ok(shown.includes(t), `${p.key} engine returned ${t}, which never reached the DOM`);
  }
});

test("the matrix panel renders the engine's rows positionally — every row, every month, and the totals row", async () => {
  for (const [key, dimension] of [["yearly-expense", "exptype"], ["yearly-income", "branch"]]) {
    const markup = await render(fakeDb(world()), q(key));
    const body = panel(markup);
    const want = await monthMatrix(fakeDb(world()), 2026, dimension);
    // Positional, not set-membership: a totals row echoing a body row, or a body row echoing the totals,
    // would satisfy any "these figures appear somewhere" check.
    assert.deepEqual(
      tableRows(body, "tbody"),
      want.rows.map((r) => [r.label, ...r.cells.map((c) => c.amount), r.total]),
      `${key} body rows drifted from the engine`,
    );
    assert.deepEqual(
      tableRows(body, "tfoot"),
      [[want.totals.label, ...want.totals.cells.map((c) => c.amount), want.totals.total]],
      `${key} totals row drifted from the engine`,
    );
    assert.deepEqual(tableRows(body, "thead")[0], [dimension === "exptype" ? "Expense type" : "Branch", ...MONTHS, "Total"]);
  }
  // 2026-07-01 (500.00) is outside the submitted range but inside the year — a yearly rollup must show it.
  assert.ok(panel(await render(fakeDb(world()), q("yearly-expense"))).includes(">500.00<"));
});

test("the P&L panel renders each line positionally against the engine's months and totals", async () => {
  const body = panel(await render(fakeDb(world()), q("pnl")));
  const want = await pnl(fakeDb(world()), 2026, 12);
  assert.deepEqual(tableRows(body, "thead")[0], ["", ...MONTHS, want.total.label]);
  assert.deepEqual(
    tableRows(body, "tbody"),
    [
      ["Income", ...want.months.map((m) => m.income), want.total.income],
      ["Expenses", ...want.months.map((m) => m.expenses), want.total.expenses],
      ["Net", ...want.months.map((m) => m.net), want.total.net],
      ["Withdrawals", ...want.months.map((m) => m.withdrawals), want.total.withdrawals],
    ],
    "a P&L line drifted from the engine",
  );
});

test("the detail panels render the engine's rows positionally, blanks included", async () => {
  const { expenseDetail, incomeDetail } = await import("../../lib/reports/detail.ts");
  const eBody = panel(await render(fakeDb(world()), q("monthly-expense")));
  const e = await expenseDetail(fakeDb(world()), RANGE);
  assert.deepEqual(
    tableRows(eBody, "tbody"),
    e.rows.map((r) => [r.expdate, r.typeName, r.initials, r.expdscr ?? "", r.expreason ?? "", r.expchecknum == null ? "" : String(r.expchecknum), r.amount]),
  );
  const iBody = panel(await render(fakeDb(world()), q("monthly-income")));
  const i = await incomeDetail(fakeDb(world()), RANGE);
  assert.deepEqual(
    tableRows(iBody, "tbody"),
    i.rows.map((r) => [r.fndsdate, r.attorney, r.fndsdesc ?? "", r.fndscaseid == null ? "" : String(r.fndscaseid), r.fndspayee ?? "", r.fndsbranch ?? "", r.amount]),
  );
});

// --- structural: nothing placeholder-shaped reaches the DOM, in any panel -------------------------

test("no panel ever renders Null, null, undefined, NaN or [object Object] in any field", async () => {
  const bad = new Set(["Null", "null", "undefined", "NaN", "[object Object]", "NULL"]);
  for (const p of PRESETS) {
    const markup = await render(fakeDb(world()), q(p.key));
    for (const t of texts(markup)) assert.equal(bad.has(t), false, `${p.key} rendered a text node "${t}"`);
    assert.equal(markup.includes("[object Object]"), false, `${p.key} markup carries [object Object]`);
    assert.equal(/>\s*NaN\s*</.test(markup), false, `${p.key} markup carries NaN`);
  }
});

test("an untouched month and a null column render as blank cells, not as text", async () => {
  // One receipt in April only: every other month of the matrix is structurally empty.
  const sparse = { ...world(), tblfundsrcvd: [{ fndsid: 9, fndsdate: "2026-04-10", fndspmt: 5.0, fndsdesc: null, fndsbranch: "North", fndscaseid: null, fndspayee: null }] };
  const body = panel(await render(fakeDb(sparse), q("yearly-income")));
  assert.equal((body.match(/<td><\/td>/g) ?? []).length >= 11, true, "empty months must be blank <td> cells");
  assert.ok(body.includes(">5.00<"));
  // The detail view's nullable columns (description, reason, check #, payee, case #) are blank too.
  const detail = panel(await render(fakeDb(world()), q("monthly-income")));
  assert.ok(detail.includes("<td></td>"), "a null detail column must render blank");
});

// --- guardrails ----------------------------------------------------------------------------------

test("the session check runs on every render and the panel carries no figures when it redirects", async () => {
  await render(fakeDb(world()), q("pnl"));
  assert.equal(session.state.calls, 1, "requireSession must run on every render");
  session.state.redirect = true;
  await assert.rejects(() => render(fakeDb(world()), q("pnl")), /NEXT_REDIRECT/);
  assert.equal(session.state.calls, 2);
  assert.equal(pageModule.dynamic, "force-dynamic", "a session-gated page must not be statically cached");
});

test("an invalid or missing range renders the empty panel and never reaches the database", async () => {
  for (const sp of [{}, { preset: "pnl" }, { start: START, preset: "pnl" }, { start: "2026-06-30", end: "2026-01-01", preset: "pnl" }, { start: "2026-02-31", end: END, preset: "pnl" }, { start: START, end: END, preset: "no-such" }]) {
    dbclient.state.calls = 0;
    const db = fakeDb(world());
    const body = panel(await render(db, sp));
    assert.equal(texts(body).filter((t) => /^-?\d+\.\d{2}$/.test(t)).length, 0, `${JSON.stringify(sp)} rendered figures`);
    assert.equal(db.reads, 0, `${JSON.stringify(sp)} hit the database`);
    assert.ok(texts(body).some((t) => /date range|start and end/i.test(t)), `${JSON.stringify(sp)} left the panel silent instead of saying what is missing`);
    assert.equal(dbclient.state.calls, 0, `${JSON.stringify(sp)} built a db client`);
  }
});

test("the page never writes, and runs exactly one preset's engine per submit", async () => {
  const db = fakeDb(world());
  await render(db, q("monthly-expense"));
  assert.equal(db.writes, 0);
  assert.equal(dbclient.state.calls, 1, "one client per render, from the page, not per query");
});

// --- what the page HANDS each engine (a wrong bound still renders a plausible table) ---------------

test("each preset hands its engine exactly the parameters its row declares — nothing widened", () => {
  const want = {
    "monthly-expense": { start: START, end: END },
    "monthly-income": { start: START, end: END },
    "yearly-expense": { year: 2026, dimension: "exptype" },
    "yearly-income": { year: 2026, dimension: "branch" },
    pnl: { year: 2026, asOfMonth: 12 },
    "consultant-fees": { start: START, end: END, description: "consultant" },
    "accountant-export": { year: 2026, asOfMonth: 12 },
  };
  assert.deepEqual(PRESETS.map((p) => p.key).sort(), Object.keys(want).sort());
  for (const p of PRESETS) assert.deepEqual(p.params(RANGE), want[p.key], `${p.key} params drifted`);
});

test("a detail preset reads only the submitted range — the rows read, not just the rows returned", async () => {
  const db = fakeDb(world());
  const { data } = await runPreset(db, findPreset("monthly-expense"), RANGE);
  assert.deepEqual(data.rows.map((r) => r.expid), [2, 3, 4]);
  assert.equal(data.total, "8.60"); // 0.28 + 0.03 + 8.29
});

test("adding a preset needs neither a new engine nor a new route", async () => {
  const extra = { key: "q1-pnl", label: "Q1 P&L", engine: "pnl", params: () => ({ year: 2026, asOfMonth: 3 }), period: () => "2026 Q1" };
  const { engine, data } = await runPreset(fakeDb(world()), extra, RANGE);
  assert.equal(engine, "pnl");
  assert.equal(data.months.length, 3);
});

test("the three per-year presets take the year the range OPENS in, and the caption says so", async () => {
  const cross = { start: "2026-11-01", end: "2027-02-28" };
  for (const key of ["yearly-expense", "yearly-income", "pnl", "accountant-export"]) {
    assert.equal(findPreset(key).params(cross).year, 2026, `${key} must use the opening year`);
    assert.equal(findPreset(key).period(cross), "2026");
  }
  const body = panel(await render(fakeDb(world()), { ...cross, preset: "pnl" }));
  assert.ok(texts(body).some((t) => t.includes("2026") && !t.includes("2027")), "the caption must state the year actually rendered");
});

test("findPreset resolves an exact key only — no prefix, no case folding", () => {
  assert.equal(findPreset("pn"), undefined);
  assert.equal(findPreset("PNL"), undefined);
  assert.equal(findPreset("pnl ")?.key, undefined);
  assert.equal(findPreset("pnl").key, "pnl");
});
