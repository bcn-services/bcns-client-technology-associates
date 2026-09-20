// QA gate proof for `/dashboard` (LANE item 6). Independent fixture — deliberately NOT the engineer's:
// priorities "9", "A9", "9a", mixed case ("b1"/"B2"/"a10") so a case-sensitive sort or an `= 9` filter fails,
// and the scrambled seed order means any passing order assertion proves workStatus() sorted, not the fake.
import test from "node:test";
import assert from "node:assert/strict";
import { fakeDb } from "./fakedb.mjs";
import { renderDashboard, session, dbclient } from "./render-dashboard.mjs";

const { loadDashboard } = await import("../../lib/reports/dashboard.ts");
const { loadOpenBills } = await import("../../lib/bills/list.ts");
const { firmToday, waitingFor, workStatus } = await import("../../lib/cases/presets.ts");

const NOW = new Date("2026-09-19T16:00:00Z");
const TODAY = firmToday(NOW);

const c = (caseid, casetitle, casestatpriority, extra = {}) => ({
  caseid, casetitle, casestatpriority, casestatpointman: null, casestatduedate: null,
  casestatduedatedescription: null, casestatdescription: `d${caseid}`, casestatwaitingfor: null,
  casestartdate: "2026-01-01", ...extra,
});

const world = () => ({
  tblcase: [
    // seeded scrambled; expected priority order is a10 < b1 < B2 (case-insensitive), then caseid tiebreak
    c(70, "Golf", "B2", { casestatduedate: "2026-09-18" }),          // overdue (yesterday)
    c(30, "Charlie", "9", { casestatduedate: "2026-01-01" }),        // dropped: %9%
    c(90, "India", "a10", { casestatduedate: "2026-12-31" }),        // not overdue
    c(10, "Alpha", "A9", { casestatduedate: "2026-01-02" }),         // dropped: %9%
    c(50, "Echo", "b1", { casestatduedate: null }),                  // no target date -> not overdue
    c(60, "Foxtrot", null, { casestatduedate: "2026-01-03" }),       // dropped: null priority
    c(20, "Bravo", "9a", { casestatduedate: "2026-01-04" }),         // dropped: %9%
    c(40, "Delta", "b1", { casestatduedate: "2026-09-19", casestatwaitingfor: "Initial Advance" }), // today -> NOT past
    c(80, "Hotel", "a10", { casestatduedate: "2026-09-01", casestatwaitingfor: "INITIAL CASE MATERIAL" }), // overdue
  ],
  tblbills: [
    { billid: 101, billcaseid: 70, billnotice: "1st", billdate: "2026-09-18", billsecondnoticedate: null, billfinalnoticedate: null, billbalance: 10, billfilename: null },
    { billid: 102, billcaseid: 70, billnotice: "2nd", billdate: "2026-01-01", billsecondnoticedate: "2026-05-01", billfinalnoticedate: null, billbalance: 20, billfilename: null },
    { billid: 103, billcaseid: 90, billnotice: "Paid", billdate: "2026-01-01", billsecondnoticedate: null, billfinalnoticedate: null, billbalance: 0, billfilename: null },
  ],
  tblfundsrcvd: [{ fndsid: 1, fndscaseid: 40, fndspmt: 10 }],
});

const tile = (d, key) => d.tiles.find((t) => t.key === key);
const leaves = (markup) => [...markup.matchAll(/>([^<>]*)</g)].map((m) => m[1].trim()).filter(Boolean);

test.beforeEach(() => { session.state.calls = 0; session.state.redirect = false; dbclient.state.calls = 0; });

// ---- criterion 3: priority order + the legacy %9% substring exclusion ----

test("work-status rows are exactly workStatus(db,'','priority'), in order", async () => {
  const d = await loadDashboard(fakeDb(world()), NOW);
  const page = await workStatus(fakeDb(world()), "", "priority");
  assert.ok(!("error" in page));
  assert.deepEqual(d.rows.map((r) => r.caseid), page.rows.map((r) => r.caseid));
  assert.deepEqual(d.rows.map((r) => r.caseid), [80, 90, 40, 50, 70],
    "a10(80,90) < b1(40,50) < B2(70) case-insensitively, caseid breaking ties");
  assert.deepEqual(d.rows.map((r) => r.casestatpriority), ["a10", "a10", "b1", "b1", "B2"]);
});

test("every priority containing a 9 anywhere is excluded, and so is a null priority", async () => {
  const d = await loadDashboard(fakeDb(world()), NOW);
  const ids = d.rows.map((r) => r.caseid);
  for (const dropped of [10, 20, 30, 60]) assert.ok(!ids.includes(dropped), `case ${dropped} must be dropped`);
  assert.equal(d.rows.length, 5);
});

test("the rendered table body is those rows, in that order", async () => {
  const markup = await renderDashboard(fakeDb(world()));
  const body = markup.match(/<tbody>([\s\S]*?)<\/tbody>/)[1];
  const first = [...body.matchAll(/<tr[^>]*>\s*<td[^>]*>.*?>(\d+)</g)].map((m) => m[1]);
  assert.deepEqual(first, ["80", "90", "40", "50", "70"]);
  assert.ok(!/>9</.test(body) && !/A9|9a/.test(body), "no 9-priority case leaked into the table");
});

// ---- criterion 2: tile count vs. the rows its linked page displays ----

test("waiting === every row /cases/lists/waiting-for displays (EXACT)", async () => {
  const d = await loadDashboard(fakeDb(world()), NOW);
  const shown = await waitingFor(fakeDb(world()));
  assert.equal(tile(d, "waiting").count, shown.rows.length);
  assert.equal(tile(d, "waiting").count, 2);
  assert.equal(tile(d, "waiting").href, "/cases/lists/waiting-for");
});

test("unpaid === every row /bills displays (EXACT); due is a strict subset of it (SUPERSET)", async () => {
  const d = await loadDashboard(fakeDb(world()), NOW);
  const shown = (await loadOpenBills(fakeDb(world()), TODAY)).flatMap((g) => g.rows);
  assert.equal(tile(d, "unpaid").count, shown.length);
  assert.equal(tile(d, "unpaid").count, 2, "the Paid bill is not an open notice stage");
  assert.equal(tile(d, "due").count, shown.filter((b) => b.due).length);
  assert.equal(tile(d, "due").count, 1, "the 1-day-old 1st notice is not yet due");
  assert.equal(tile(d, "due").href, "/bills");
  assert.ok(tile(d, "due").count < shown.length, "CONFLICT: /bills displays more rows than the due tile counts");
});

test("overdue is a strict subset of the rows /cases/lists/work-status?sort=priority displays (SUPERSET)", async () => {
  const d = await loadDashboard(fakeDb(world()), NOW);
  const page = await workStatus(fakeDb(world()), "", "priority");
  assert.equal(tile(d, "overdue").href, "/cases/lists/work-status?sort=priority");
  assert.equal(tile(d, "overdue").count, 2, "cases 70 and 80; today's date is not past, and null is not past");
  assert.ok(tile(d, "overdue").count < page.rows.length, "CONFLICT: that page displays 5 rows, the tile counts 2");
});

// ---- criterion 1: the four labels as visible text, and the journey-06 strict-mode count ----

test("journey 06's four regexes: /due/i matches two distinct text nodes, the rest match one", async () => {
  const markup = await renderDashboard(fakeDb(world()));
  const nodes = leaves(markup);
  assert.deepEqual(nodes.filter((t) => /waiting/i.test(t)), ["Waiting"]);
  assert.deepEqual(nodes.filter((t) => /unpaid/i.test(t)), ["Unpaid"]);
  assert.deepEqual(nodes.filter((t) => /overdue/i.test(t)), ["Overdue"]);
  // The Critical: getByText(/due/i) is ambiguous -> Playwright strict mode violation, fixable only in tests/journeys.
  assert.deepEqual(nodes.filter((t) => /due/i.test(t)), ["Due", "Overdue"]);
});

// ---- guardrail: read-only ----

test("rendering the dashboard issues zero writes", async () => {
  const db = fakeDb(world());
  await renderDashboard(db);
  assert.equal(db.writes, 0);
  assert.ok(db.reads > 0);
  assert.equal(session.state.calls, 1, "the session check still runs");
});
