// Unit tests for /bills (lib/bills/list.ts + app/bills/bills-list-view.tsx + app/bills/page.tsx exports).
// Fake PostgREST (pattern: tests/cases/create.test.mjs) that APPLIES `.in` / `.eq` filters and resolves the
// `tblcase(...)` embed — fixtures are never pre-filtered. Expected values are written-out literals.
import { test } from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

globalThis.React = React; // tsx compiles .tsx with the classic JSX runtime
const { loadOpenBills, runBillsList } = await import("../../lib/bills/list.ts");
const { BillsListView } = await import("../../app/bills/bills-list-view.tsx");

const WRITES = ["insert", "update", "delete", "upsert", "rpc"];
function fakeDb(tables) {
  const calls = [];
  const froms = [];
  return {
    calls,
    froms,
    rpc: (...a) => { calls.push(["(db)", "rpc", ...a]); return Promise.resolve({ data: null, error: null }); },
    from(table) {
      froms.push(table);
      const q = { filters: [], select: "", single: false };
      const b = new Proxy({}, {
        get(_, k) {
          if (k === "then") {
            let rows = (tables[table] ?? []).filter((r) => q.filters.every((f) => f(r))).map((r) => ({ ...r }));
            if (table === "tblbills" && q.select.includes("tblcase(")) {
              for (const r of rows) {
                const c = tables.tblcase.find((x) => x.caseid === r.billcaseid);
                r.tblcase = c ? { caseid: c.caseid } : null;
              }
            }
            const data = q.single ? rows[0] ?? null : rows;
            return (res, rej) => Promise.resolve({ data, error: null }).then(res, rej);
          }
          return (...a) => {
            calls.push([table, k, ...a]);
            if (k === "select") q.select = String(a[0] ?? "");
            if (k === "eq") q.filters.push((r) => r[a[0]] === a[1]);
            if (k === "in") q.filters.push((r) => a[1].includes(r[a[0]]));
            if (k === "maybeSingle" || k === "single") q.single = true;
            return b;
          };
        },
      });
      return b;
    },
  };
}

const NOW = new Date("2026-09-12T16:00:00Z"); // firm-local today = 2026-09-12
const TODAY = "2026-09-12";
const bill = (billid, billcaseid, billnotice, billdate, o = {}) => ({
  billid, billcaseid, billdate, billnotice, billhours: 1, billbalance: 100, billfilename: `Bill${billcaseid} Fixture ${billdate.replaceAll("-", " ")}-1`,
  billsecondnoticedate: null, billfinalnoticedate: null, billpaiddate: null, billtype: "timesheet", ...o,
});
const cases = (...ids) => ids.map((caseid) => ({ caseid, casetitle: `Invented ${caseid}` }));

// 1st/45 days (2026-07-29), 1st/10 days (2026-09-02), 2nd with old billdate but 2nd notice 2026-09-05 (7 days;
// 134 from billdate), Final (final notice 2026-08-13 → 30 days), plus Paid and Cancelled that must not show.
const world = () => fakeDb({
  tblbills: [
    bill(701, 990701, "Paid", "2026-06-01", { billpaiddate: "2026-07-01" }),
    bill(702, 990702, "1st", "2026-09-02", { billbalance: 250 }),
    bill(703, 990703, "Final", "2026-05-15", { billsecondnoticedate: "2026-06-20", billfinalnoticedate: "2026-08-13" }),
    bill(704, 990704, "Cancelled", "2026-01-10"),
    bill(705, 990705, "2nd", "2026-05-01", { billsecondnoticedate: "2026-09-05" }),
    bill(706, 990706, "1st", "2026-07-29", { billbalance: 1234.5 }),
  ],
  tblcase: cases(990701, 990702, 990703, 990704, 990705, 990706),
});
const render = (groups) => renderToStaticMarkup(React.createElement(BillsListView, { groups }));
const text = (html) => html.replace(/<[^>]+>/g, " ").replace(/&[a-z#0-9]+;/g, " ").replace(/\s+/g, " ").trim();
const rows = (html) => [...html.matchAll(/<tr data-testid="open-bill"[^>]*>(.*?)<\/tr>/g)].map((m) => m[1]);
const rowFor = (html, caseNo) => rows(html).find((r) => text(r).startsWith(`${caseNo} `));
const html = async (db = world()) => render(await loadOpenBills(db, TODAY));

test("exactly the three open ones show — every 1st, 2nd and Final bill; Paid and Cancelled absent", async () => {
  const shown = rows(await html()).map((r) => text(r).split(" ")[0]).sort();
  assert.deepEqual(shown, ["990702", "990703", "990705", "990706"]);
});

test("stage headings appear in order 1st, 2nd, Final", async () => {
  // Only the open-stage headings' ORDER is checked here; which stages appear at all is test 1's job.
  const headings = [...(await html()).matchAll(/<h2[^>]*>(.*?)<\/h2>/g)].map((m) => m[1]).filter((h) => ["1st", "2nd", "Final"].includes(h));
  assert.deepEqual(headings, ["1st", "2nd", "Final"]);
});

test("within 1st, the 45-day bill sorts above the 10-day bill", async () => {
  const first = (await html()).match(/<section data-stage="1st".*?<\/section>/)[0];
  assert.deepEqual(rows(first).map((r) => text(r).split(" ")[0]), ["990706", "990702"]);
});

test("days since last notice: 1st 45 days, 1st 10 days, 2nd counts from its 2nd-notice date (7 days), Final 30 days", async () => {
  const h = await html();
  assert.match(text(rowFor(h, 990706)), / 45 days/);
  assert.match(text(rowFor(h, 990702)), / 10 days/);
  assert.match(text(rowFor(h, 990705)), / 7 days/);
  assert.match(text(rowFor(h, 990703)), / 30 days/);
});

test("due badge on the 45-day 1st row, none on the 10-day 1st row", async () => {
  const h = await html();
  assert.match(rowFor(h, 990706), /data-testid="due-badge"[^>]*>due</);
  assert.doesNotMatch(rowFor(h, 990702), /due-badge/);
});

test("links: case number → /cases/<n>, filename → /bills/<id>; row shows bill date and balance", async () => {
  const r = rowFor(await html(), 990706);
  assert.match(r, /<a [^>]*href="\/cases\/990706"[^>]*>990706<\/a>/);
  assert.match(r, /<a [^>]*href="\/bills\/706"[^>]*>Bill990706 Fixture 2026 07 29-1<\/a>/);
  assert.match(text(r), /2026-07-29 1234\.50 45 days/);
});

test("one query (tblbills with tblcase embed) whether 3 or 100 bills are open — no per-row fetch", async () => {
  for (const n of [3, 100]) {
    const db = fakeDb({
      tblbills: Array.from({ length: n }, (_, i) => bill(1000 + i, 990710 + i, "1st", "2026-08-01")),
      tblcase: cases(...Array.from({ length: n }, (_, i) => 990710 + i)),
    });
    const groups = await loadOpenBills(db, TODAY);
    assert.equal(groups[0].rows.length, n);
    assert.deepEqual(db.calls.filter((c) => c[1] === "select").map((c) => c[0]), ["tblbills"], `n=${n}`); // reads only; writes are test 8's
    assert.match(db.calls.find((c) => c[1] === "select")[2], /tblcase\(caseid\)/);
  }
});

const sessionClient = (role) => ({ auth: { getUser: async () => ({ data: { user: { id: "u1", email: "s@example.test" } } }) },
  from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { role, personid: 1 } }) }) }) }) });

test("read-only: page entry point + render make zero writes; markup has no form/action; page exports no action", async () => {
  const db = world();
  const h = render(await runBillsList({ db, now: NOW, client: sessionClient("admin") })); // admin: the role gate is test 9's
  assert.ok(db.calls.length > 0, "entry point ran the query");
  assert.deepEqual(db.calls.filter((c) => WRITES.includes(c[1])), []);
  assert.doesNotMatch(h, /<form|<button|action=/i);
  const page = await import("../../app/bills/page.tsx");
  assert.deepEqual(Object.keys(page).filter((k) => k !== "default" && k !== "dynamic" && k !== "__esModule"), []);
});

test("staff session (real requireSession, injected client) can load the list", async () => {
  const groups = await runBillsList({ db: world(), now: NOW, client: sessionClient("staff") });
  assert.ok(groups.some((g) => g.rows.length > 0));
});
