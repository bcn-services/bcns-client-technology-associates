// `/dashboard`: the four count tiles and the Work Status Sheet under them. Every number is asserted to be
// the row count of the list page its tile links to, produced by the same lib call that page makes.
import test from "node:test";
import assert from "node:assert/strict";
import { fakeDb } from "./fakedb.mjs";
import { renderToStaticMarkup } from "react-dom/server";
import { renderDashboard, pageModule, session, dbclient, texts, React } from "./render-dashboard.mjs";

const { loadDashboard, WORK_STATUS_HREF } = await import("../../lib/reports/dashboard.ts");
const { loadOpenBills, runBillsList } = await import("../../lib/bills/list.ts");
const { loadUnbilled } = await import("../../lib/reports/unbilled.ts");
const { BillsListView } = await import("../../app/bills/bills-list-view.tsx");
const { firmToday, waitingFor, workStatus } = await import("../../lib/cases/presets.ts");

const NOW = new Date("2026-09-19T16:00:00Z");
const TODAY = firmToday(NOW);

// Bills: two stages due, one fresh, one exactly on the 30-day boundary, one closed (must never be counted).
// Cases: a 9-priority case and a null-priority case that workStatus() drops, so a tile counting them would fail.
const world = () => ({
  tblbills: [
    { billid: 1, billcaseid: 10, billnotice: "1st", billdate: "2026-08-10", billsecondnoticedate: null, billfinalnoticedate: null, billbalance: 100, billfilename: null },
    { billid: 2, billcaseid: 10, billnotice: "1st", billdate: "2026-09-14", billsecondnoticedate: null, billfinalnoticedate: null, billbalance: 200, billfilename: null },
    { billid: 3, billcaseid: 11, billnotice: "Final", billdate: "2026-01-01", billsecondnoticedate: "2026-03-01", billfinalnoticedate: "2026-07-21", billbalance: 300, billfilename: null },
    { billid: 4, billcaseid: 11, billnotice: "Settled", billdate: "2026-01-01", billsecondnoticedate: null, billfinalnoticedate: null, billbalance: 0, billfilename: null },
    { billid: 5, billcaseid: 12, billnotice: "2nd", billdate: "2026-06-01", billsecondnoticedate: "2026-08-20", billfinalnoticedate: null, billbalance: 400, billfilename: null },
  ],
  tblcase: [
    { caseid: 1, casetitle: "Alpha", casestatwaitingfor: "Initial Advance", casestatpriority: "P1", casestatpointman: "KJS", casestatduedate: "2026-08-01", casestatduedatedescription: null, casestatdescription: "first", casestartdate: "2026-01-01" },
    { caseid: 2, casetitle: "Bravo", casestatwaitingfor: "initial case material", casestatpriority: "a9x", casestatpointman: "RMD", casestatduedate: "2026-08-02", casestatduedatedescription: null, casestatdescription: "nine", casestartdate: "2026-01-01" },
    { caseid: 3, casetitle: "Charlie", casestatwaitingfor: null, casestatpriority: "P2", casestatpointman: null, casestatduedate: "2026-12-01", casestatduedatedescription: null, casestatdescription: "later", casestartdate: "2026-01-01" },
    { caseid: 4, casetitle: "Delta", casestatwaitingfor: "something else", casestatpriority: null, casestatpointman: "JH", casestatduedate: "2026-08-03", casestatduedatedescription: null, casestatdescription: "no priority", casestartdate: "2026-01-01" },
    { caseid: 5, casetitle: "Echo", casestatwaitingfor: null, casestatpriority: "b3", casestatpointman: "RC", casestatduedate: null, casestatduedatedescription: null, casestatdescription: "no date", casestartdate: "2026-01-01" },
    { caseid: 6, casetitle: "Foxtrot", casestatwaitingfor: "Initial Advance and Initial Case Material", casestatpriority: "P10", casestatpointman: "IUO", casestatduedate: "2026-02-02", casestatduedatedescription: null, casestatdescription: "old", casestartdate: "2026-01-01" },
  ],
  tblfundsrcvd: [{ fndsid: 1, fndscaseid: 1, fndspmt: 25.5 }],
});

const tile = (d, key) => d.tiles.find((t) => t.key === key);

test.beforeEach(() => { session.state.calls = 0; session.state.redirect = false; dbclient.state.calls = 0; });

// --- criterion 2: each tile's count equals the rows the page it links to displays -----------------

test("unpaid equals every open bill /bills displays, and due equals the subset /bills badges as due", async () => {
  const d = await loadDashboard(fakeDb(world()), NOW);
  const shown = (await loadOpenBills(fakeDb(world()), TODAY)).flatMap((g) => g.rows);
  assert.equal(tile(d, "unpaid").count, shown.length);
  assert.equal(tile(d, "unpaid").count, 4, "the Settled bill is not open and must not be counted");
  assert.equal(tile(d, "due").count, shown.filter((b) => b.due).length);
  assert.equal(tile(d, "due").count, 3, "40 days, 30 days exactly, and a final notice 60 days old");
  assert.equal(tile(d, "unpaid").href, "/bills");
  assert.equal(tile(d, "due").href, "/bills?due=1");
});

// The Due tile's number is the length of the list behind its link: /bills?due=1 renders runBillsList({ dueOnly: true }).
test("due equals the length of the /bills?due=1 list, and every row in it is due", async () => {
  const d = await loadDashboard(fakeDb(world()), NOW);
  const list = (await runBillsList({ db: fakeDb(world()), now: NOW, session: Promise.resolve({ role: "staff" }), dueOnly: true })).flatMap((g) => g.rows);
  assert.equal(tile(d, "due").count, list.length);
  assert.equal(list.length, 3);
  assert.deepEqual(list.map((b) => b.billid).sort(), [1, 3, 5]);
  assert.ok(list.every((b) => b.due));
  const all = (await runBillsList({ db: fakeDb(world()), now: NOW, session: Promise.resolve({ role: "staff" }) })).flatMap((g) => g.rows);
  assert.equal(all.length, tile(d, "unpaid").count, "plain /bills stays the unfiltered open list");
});

// Unbilled := time with actbilled=false AND actbillid null.
const unbilledWorld = () => ({
  ...world(),
  tblactivity: [
    { actid: 1, actcaseid: 1, actdate: "2026-09-01", actdescription: "unbilled", acthrs: 1.5, actbilled: false, actbillid: null },
    { actid: 2, actcaseid: 1, actdate: "2026-09-02", actdescription: "billed on a bill", acthrs: 2, actbilled: true, actbillid: 5 },
    { actid: 3, actcaseid: 2, actdate: "2026-09-03", actdescription: "legacy billed, no bill id", acthrs: 1, actbilled: true, actbillid: null },
    { actid: 4, actcaseid: 2, actdate: "2026-09-04", actdescription: "unbilled too", acthrs: 0.5, actbilled: false, actbillid: null },
    { actid: 5, actcaseid: 2, actdate: "2026-09-05", actdescription: "attached to a bill, flag still false", acthrs: 1, actbilled: false, actbillid: 5 },
  ],
  // Expenses are deliberately not counted (nothing writes expbillid); an unbilled-looking expense must not move the tile.
  tblexpenses: [{ expid: 1, expcaseid: 1, expbillid: null, expdate: "2026-09-01", expdscr: "filing fee", expamount: 50 }],
});

test("unbilled counts only unbilled time, and the tile count equals the /unbilled row count", async () => {
  const d = await loadDashboard(fakeDb(unbilledWorld()), NOW);
  const u = await loadUnbilled(fakeDb(unbilledWorld()));
  assert.deepEqual(u.time.map((r) => r.actid), [1, 4], "billed (flag or bill id) time is excluded");
  assert.equal(tile(d, "unbilled").count, 2, "the unbilled expense is not counted");
  assert.equal(tile(d, "unbilled").count, u.time.length);
  assert.equal(tile(d, "unbilled").href, "/unbilled");
});

test("unbilled is zero when everything is billed", async () => {
  const w = unbilledWorld();
  w.tblactivity.forEach((r) => { r.actbilled = true; });
  assert.equal(tile(await loadDashboard(fakeDb(w), NOW), "unbilled").count, 0);
});

// A failed unbilled read blanks only its own tile; the page still renders (like Waiting / Overdue).
const failingUnbilled = (w) => {
  const db = fakeDb(w);
  const realFrom = db.from.bind(db);
  db.from = (t) => {
    if (t !== "tblactivity") return realFrom(t);
    const b = realFrom(t);
    b.then = (res) => res({ data: null, error: { message: "boom" } });
    return b;
  };
  return db;
};

test("a failed unbilled read gives a null tile and the dashboard still renders", async () => {
  const origErr = console.error;
  console.error = () => {};
  try {
    const d = await loadDashboard(failingUnbilled(unbilledWorld()), NOW);
    assert.equal(tile(d, "unbilled").count, null);
    assert.equal(tile(d, "unpaid").count, 4, "the other tiles are unaffected");
    const markup = await renderDashboard(failingUnbilled(unbilledWorld()));
    assert.match(markup, /data-testid="tile-unbilled"[^>]*>—</);
  } finally { console.error = origErr; }
});

test("/bills?due=1 with nothing due says 'No bills are due.'; plain /bills keeps 'No open bills.'", () => {
  const view = (due) => renderToStaticMarkup(React.createElement(BillsListView, { groups: [], due }));
  assert.match(view(true), /No bills are due\./);
  assert.match(view(false), /No open bills\./);
});

test("waiting equals every row /cases/lists/waiting-for displays", async () => {
  const d = await loadDashboard(fakeDb(world()), NOW);
  const w = await waitingFor(fakeDb(world()));
  assert.equal(tile(d, "waiting").count, w.rows.length);
  assert.equal(tile(d, "waiting").count, 3);
  assert.equal(tile(d, "waiting").href, "/cases/lists/waiting-for");
});

test("overdue counts only work-status rows whose target date has passed, from the linked page's own row set", async () => {
  const d = await loadDashboard(fakeDb(world()), NOW);
  const ws = await workStatus(fakeDb(world()), "", "priority");
  const want = ws.rows.filter((r) => r.casestatduedate != null && r.casestatduedate < TODAY);
  assert.equal(tile(d, "overdue").count, want.length);
  assert.equal(tile(d, "overdue").count, 2, "case 2 is past its date but carries a 9 priority, so it is not on the sheet");
  assert.equal(tile(d, "overdue").href, WORK_STATUS_HREF);
});

// --- criterion 3: the table is workStatus()'s own rows, in priority order -------------------------

test("the work-status table is exactly workStatus(db, '', 'priority') — 9-priority and null-priority cases dropped", async () => {
  const d = await loadDashboard(fakeDb(world()), NOW);
  const ws = await workStatus(fakeDb(world()), "", "priority");
  assert.deepEqual(d.rows.map((r) => r.caseid), ws.rows.map((r) => r.caseid));
  assert.deepEqual(d.rows.map((r) => r.caseid), [5, 1, 6, 3], "priority text, case-insensitive, then case #");
  assert.equal(d.rows.some((r) => r.caseid === 2), false, "casestatpriority containing a 9 is excluded");
  assert.equal(d.rows.some((r) => r.caseid === 4), false, "a null casestatpriority is excluded");
});

test("the dashboard never writes", async () => {
  const db = fakeDb(world());
  await loadDashboard(db, NOW);
  assert.equal(db.writes, 0);
});

// --- criterion 1: journey 06's four labels reach the DOM as plain visible text --------------------

test("the page renders Due, Overdue, Waiting, Unpaid and Unbilled as plain text, each once as a tile label", async () => {
  const markup = await renderDashboard(fakeDb(world()));
  const nodes = texts(markup);
  for (const label of ["Due", "Overdue", "Waiting", "Unpaid", "Unbilled"]) {
    assert.equal(nodes.filter((t) => t === label).length, 1, `${label} must appear exactly once as a tile label`);
    assert.ok(new RegExp(`>${label}<`).test(markup), `${label} must be a plain text node, not an attribute`);
  }
  // Journey 06 uses getByText, which is strict about multiple matches: nothing else on the page may carry
  // these words. /due/i legitimately matches both "Due" and "Overdue" — see the report's CONFLICT line.
  assert.deepEqual(nodes.filter((t) => /due/i.test(t)), ["Due", "Overdue"]);
  assert.deepEqual(nodes.filter((t) => /overdue/i.test(t)), ["Overdue"]);
  assert.deepEqual(nodes.filter((t) => /waiting/i.test(t)), ["Waiting"]);
  assert.deepEqual(nodes.filter((t) => /unpaid/i.test(t)), ["Unpaid"]);
});

test("each tile renders its own count and links to the page that count came from", async () => {
  const markup = await renderDashboard(fakeDb(world()));
  const d = await loadDashboard(fakeDb(world()), NOW);
  for (const t of d.tiles) {
    assert.match(markup, new RegExp(`data-testid="tile-${t.key}"[^>]*>${t.count}<`), `${t.key} shows a different number than the loader returned`);
    assert.ok(markup.includes(`href="${t.href.replace(/&/g, "&amp;")}"`), `${t.key} does not link to ${t.href}`);
  }
});

test("the rendered table body is the loader's rows in order, and carries no placeholder text", async () => {
  const markup = await renderDashboard(fakeDb(world()));
  const d = await loadDashboard(fakeDb(world()), NOW);
  const body = markup.match(/<tbody>([\s\S]*?)<\/tbody>/)[1];
  const ids = [...body.matchAll(/href="\/cases\/(\d+)"/g)].map((m) => Number(m[1]));
  assert.deepEqual(ids, d.rows.map((r) => r.caseid));
  for (const bad of ["null", "undefined", "NaN", "[object Object]"]) assert.equal(texts(markup).includes(bad), false, `rendered ${bad}`);
});

test("the session check runs on every render and the page is never statically cached", async () => {
  await renderDashboard(fakeDb(world()));
  assert.equal(session.state.calls, 1);
  assert.equal(dbclient.state.calls, 1, "one client per render");
  session.state.redirect = true;
  await assert.rejects(() => renderDashboard(fakeDb(world())), /NEXT_REDIRECT/);
  assert.equal(pageModule.dynamic, "force-dynamic");
});

// --- degraded reads ------------------------------------------------------------------------------

test("a failing case read propagates instead of rendering a silently wrong zero", async () => {
  const db = fakeDb(world());
  const realFrom = db.from.bind(db);
  db.from = (t) => (t === "tblcase" ? { select: () => { throw new Error("boom"); } } : realFrom(t));
  await assert.rejects(() => loadDashboard(db, NOW));
});
