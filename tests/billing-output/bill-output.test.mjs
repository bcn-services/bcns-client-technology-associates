// Item 8 bill output (unit): state + Download / Finalize / Send / Send notice on the case Bills panel and /bills,
// driven through the real BillsPanel / runBillsList + BillsListView with an injected fake PostgREST that APPLIES
// eq / in / order / range. Legacy output is compared to markup captured from HEAD (7801e70) before any item-8 change:
// fixtures/i8-legacy-before.json. All names and figures are invented.
import { test } from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

globalThis.React = React; // tsx compiles .tsx with the classic JSX runtime
const { BillsPanel } = await import("../../app/bills/bills-panel.tsx");
const { BillsListView } = await import("../../app/bills/bills-list-view.tsx");
const { runBillsList, loadOpenBills } = await import("../../lib/bills/list.ts");
const { saveNoticePdf } = await import("../../lib/bill-docs/notice.ts");

const ROOT = new URL("../..", import.meta.url).pathname;
const BEFORE = JSON.parse(readFileSync(join(ROOT, "tests/billing-output/fixtures/i8-legacy-before.json"), "utf8"));
const ADMIN = { role: "admin" }, STAFF = { role: "staff" };
const NOW = new Date("2026-09-12T16:00:00Z"); // firm today 2026-09-12, the date the HEAD snapshot used

function fakeDb(tables) {
  const calls = [];
  return {
    calls,
    from(table) {
      const q = { filters: [], orders: [], range: null };
      const b = new Proxy({}, {
        get(_, k) {
          if (k === "then") {
            let rows = (tables[table] ?? []).filter((r) => q.filters.every((f) => f(r))).map((r) => ({ ...r }));
            for (const [col, asc] of [...q.orders].reverse()) rows = [...rows].sort((x, y) => (x[col] < y[col] ? -1 : x[col] > y[col] ? 1 : 0) * (asc ? 1 : -1));
            if (q.range) rows = rows.slice(q.range[0], q.range[1] + 1);
            return (res, rej) => Promise.resolve({ data: rows, error: null }).then(res, rej);
          }
          return (...a) => {
            calls.push([table, k, ...a]);
            if (k === "eq") q.filters.push((r) => r[a[0]] === a[1]);
            else if (k === "in") q.filters.push((r) => a[1].includes(r[a[0]]));
            else if (k === "order") q.orders.push([a[0], a[1]?.ascending !== false]);
            else if (k === "range") q.range = a;
            else if (k !== "select") throw new Error(`fake db: unsupported ${k}`);
            return b;
          };
        },
      });
      return b;
    },
  };
}
const tablesRead = (db) => db.calls.filter((c) => c[1] === "select").map((c) => `${c[0]}:${c[2]}`);

// --- legacy: identical to HEAD -------------------------------------------------------------------------------
const LCASE = 990901;
const legacy = [
  { billid: 9101, billcaseid: LCASE, billdate: "2019-03-04", billtype: null, billbalance: 75.5, billnotice: "Paid", billsecondnoticedate: null, billfinalnoticedate: null, billpaiddate: "2019-04-01", billhours: 0, billfilename: "Bill990901 Fixture 2019 03 04-0", billfinalizedat: null, billpdfpath: null, billsentat: null, supersedesbillid: null },
  { billid: 9102, billcaseid: LCASE, billdate: "2019-01-02", billtype: null, billbalance: 300, billnotice: "2nd", billsecondnoticedate: "2019-02-02", billfinalnoticedate: null, billpaiddate: null, billhours: 0, billfilename: "Bill990901 Fixture 2019 01 02-0", billfinalizedat: null, billpdfpath: null, billsentat: null, supersedesbillid: null },
  { billid: 9103, billcaseid: LCASE, billdate: "2018-11-02", billtype: null, billbalance: 120, billnotice: "1st", billsecondnoticedate: null, billfinalnoticedate: null, billpaiddate: null, billhours: 0, billfilename: null, billfinalizedat: null, billpdfpath: null, billsentat: null, supersedesbillid: null },
].map((b) => ({ ...b, tblcase: { caseid: b.billcaseid } }));

for (const [who, session] of [["admin", ADMIN], ["staff", STAFF]]) {
  test(`legacy bills: case panel (${who}) renders exactly what it rendered before item 8, with no output reads`, async () => {
    const db = fakeDb({ tblbills: legacy, tblfundsrcvd: [] });
    assert.equal(renderToStaticMarkup(await BillsPanel({ caseId: LCASE, db, session })), BEFORE[`panel-${who}`]);
    assert.deepEqual(db.calls.filter((c) => c[1] === "select").map((c) => c[0]), ["tblbills", "tblfundsrcvd"]);
  });
  test(`legacy bills: /bills (${who}) renders exactly what it rendered before item 8, with no output reads`, async () => {
    const db = fakeDb({ tblbills: legacy });
    const groups = await runBillsList({ db, now: NOW, session: Promise.resolve(session) });
    assert.equal(renderToStaticMarkup(React.createElement(BillsListView, { groups, admin: session === ADMIN })), BEFORE[`list-${who}`]);
    assert.deepEqual(db.calls.filter((c) => c[1] === "select").map((c) => c[0]), ["tblbills"]);
  });
}

// --- typed bills ----------------------------------------------------------------------------------------------
const CASE = 990902;
const KEY = (id) => `bills/${CASE}/Bill${CASE} Invented ${id}.pdf`;
const FIN = "2026-09-01T15:00:00Z";
const typed = (billid, billdate, o = {}) => ({
  billid, billcaseid: CASE, billdate, billtype: "timesheet", billbalance: 300, billhours: 1.5, billnotice: "1st",
  billsecondnoticedate: null, billfinalnoticedate: null, billpaiddate: null, billfilename: `Bill${CASE} Invented ${billid}`,
  billfinalizedat: null, billpdfpath: null, billsentat: null, supersedesbillid: null, tblcase: { caseid: CASE }, ...o,
});
const line = (billid) => ({ billid, lineno: 1, kind: "charge", linedate: "2026-08-20", description: "Invented work", personid: null, hours: "1.500", rate: "200.00", amount: "300.00" });
const BILLS = [
  typed(9201, "2026-09-10"),                                                         // draft → Finalize
  typed(9202, "2026-09-09"),                                                         // draft with a revision → no Finalize
  typed(9203, "2026-09-08", { supersedesbillid: 9202 }),                             // its revision, a draft → Finalize
  typed(9204, "2026-09-07", { billfinalizedat: FIN, billpdfpath: KEY(9204) }),       // finalized, lines intact → Download + Send
  typed(9205, "2026-09-06", { billfinalizedat: FIN, billpdfpath: KEY(9205), billsentat: "2026-09-02T03:30:00Z" }), // sent → Send again
  typed(9206, "2026-09-05", { billfinalizedat: FIN, billpdfpath: KEY(9206), billbalance: 999 }),                  // lines don't add up → no Send
  typed(9207, "2026-09-04", { billfinalizedat: FIN, billpdfpath: KEY(9207), billnotice: "2nd", billsentat: "2026-09-03T12:00:00Z" }), // → Send notice
  typed(9208, "2026-09-03", { billfinalizedat: FIN }),                               // finalized, no PDF → state only
  typed(9209, "2026-09-02", { billfinalizedat: FIN, billpdfpath: KEY(9209), billnotice: "Cancelled" }),            // closed → Download only
];
const LINES = [9204, 9205, 9206, 9207, 9209].map(line);
const EXPECT = { // billid → [state, download, finalize, send, sendNotice] for an admin
  9201: ["Draft", false, true, false, false],
  9202: ["Draft", false, false, false, false],
  9203: ["Draft", false, true, false, false],
  9204: ["Finalized", true, false, "Send", false],
  9205: ["Sent 2026-09-01", true, false, "Send again", false], // 03:30Z is still Sept 1 in the firm zone
  9206: ["Finalized", true, false, false, false],
  9207: ["Sent 2026-09-03", true, false, "Send again", true],
  9208: ["Finalized", false, false, false, false],
  9209: ["Finalized", true, false, false, false],
};

const outputRow = (html, id) => {
  const m = html.match(new RegExp(`<li data-testid="bill-output-row" data-billid="${id}"[^>]*>(.*?)</li>`));
  return m?.[1];
};
const listRow = (html, id) => html.match(new RegExp(`<tr data-testid="open-bill"[^>]*>((?:(?!</tr>).)*href="/bills/${id}"(?:(?!</tr>).)*)</tr>`))?.[1];
function check(row, id, [state, download, finalize, send, notice], { list = false } = {}) {
  assert.ok(row, `bill ${id} has an output row`);
  assert.match(row, new RegExp(`data-testid="bill-state"[^>]*>${state}<`), `${id} state`);
  assert.equal(row.includes(`href="/bills/${id}/pdf"`), download, `${id} download`);
  assert.equal(row.includes(`href="/bills/${id}/finalize"`), finalize, `${id} finalize`);
  if (send) assert.match(row, new RegExp(`href="/bills/${id}/send${send === "Send again" ? "\\?again=1" : ""}"[^>]*>${send}<`), `${id} send`);
  else assert.equal(row.includes(`/bills/${id}/send`), false, `${id} send`);
  if (!list) assert.equal(row.includes(`href="/bills/${id}/notice"`), notice, `${id} send notice`);
}

test("case panel, admin: each typed bill's state and exactly the actions the rules allow", async () => {
  const db = fakeDb({ tblbills: BILLS, tblbilllines: LINES, tblfundsrcvd: [] });
  const html = renderToStaticMarkup(await BillsPanel({ caseId: CASE, db, session: ADMIN }));
  for (const [id, want] of Object.entries(EXPECT)) check(outputRow(html, id), id, want);
  assert.equal(html.match(/data-testid="bill-output-row"/g).length, BILLS.length);
  // Two batched output reads, not one per bill.
  assert.equal(tablesRead(db).filter((s) => s.startsWith("tblbilllines")).length, 1);
  assert.deepEqual(db.calls.find((c) => c[0] === "tblbilllines" && c[1] === "in"), ["tblbilllines", "in", "billid", [9204, 9205, 9206, 9207, 9209]]);
  assert.deepEqual(db.calls.find((c) => c[1] === "in" && c[2] === "supersedesbillid"), ["tblbills", "in", "supersedesbillid", [9201, 9202, 9203]]);
});

test("case panel, staff: state and Download only — never Finalize / Send / Send notice, and no output reads", async () => {
  const db = fakeDb({ tblbills: BILLS, tblbilllines: LINES, tblfundsrcvd: [] });
  const html = renderToStaticMarkup(await BillsPanel({ caseId: CASE, db, session: STAFF }));
  for (const [id, [state, download]] of Object.entries(EXPECT)) check(outputRow(html, id), id, [state, download, false, false, false]);
  assert.doesNotMatch(html, /\/finalize"|\/send"|\/send\?|\/notice"/);
  assert.deepEqual(db.calls.filter((c) => c[1] === "select").map((c) => c[0]), ["tblbills", "tblfundsrcvd"]);
});

test("case panel: the case-bill rows keep one link each and no /billed/ text; a failed output read is a note", async () => {
  const db = fakeDb({ tblbills: BILLS, tblbilllines: LINES, tblfundsrcvd: [] });
  const html = renderToStaticMarkup(await BillsPanel({ caseId: CASE, db, session: ADMIN }));
  for (const m of html.matchAll(/<tr data-testid="case-bill"[^>]*>(.*?)<\/tr>/g)) assert.equal(m[1].match(/<a /g).length, 1);
  assert.doesNotMatch(html.replace(/<[^>]+>/g, " "), /billed/i);
  assert.doesNotMatch(html, /<button|<input|<form/);
  const broken = { ...db, from: (t) => (t === "tblbilllines" ? { select: () => { throw new Error("boom"); } } : db.from(t)) };
  const html2 = renderToStaticMarkup(await BillsPanel({ caseId: CASE, db: broken, session: ADMIN }));
  assert.match(html2, /Bill output could not be loaded\./);
  assert.match(html2, /data-testid="case-bill"/); // the rest of the panel still renders
});

test("/bills, admin: each open typed bill's state, Download, Finalize, Send; Send notice stays the existing column", async () => {
  const db = fakeDb({ tblbills: BILLS, tblbilllines: LINES });
  const groups = await runBillsList({ db, now: NOW, session: Promise.resolve(ADMIN) });
  const html = renderToStaticMarkup(React.createElement(BillsListView, { groups, admin: true }));
  for (const [id, want] of Object.entries(EXPECT)) {
    if (id === "9209") { assert.equal(listRow(html, id), undefined, "a Cancelled bill is not on the unpaid list"); continue; }
    check(listRow(html, id), id, want, { list: true });
  }
  assert.match(listRow(html, 9207), /data-testid="send-notice"[^>]*href="\/bills\/9207\/notice"/);
  assert.equal(html.match(/data-testid="send-notice"/g).length, 1, "Send notice is not duplicated");
});

test("/bills, staff: state and Download only, no output reads", async () => {
  const db = fakeDb({ tblbills: BILLS, tblbilllines: LINES });
  const groups = await runBillsList({ db, now: NOW, session: Promise.resolve(STAFF) });
  const html = renderToStaticMarkup(React.createElement(BillsListView, { groups, admin: false }));
  for (const [id, [state, download]] of Object.entries(EXPECT)) if (id !== "9209") check(listRow(html, id), id, [state, download, false, false, false], { list: true });
  assert.doesNotMatch(html, /\/finalize"|\/send"|\/send\?|\/notice"/);
  assert.deepEqual(db.calls.filter((c) => c[1] === "select").map((c) => c[0]), ["tblbills"]);
});

test("/bills: a passed session is the only auth check (the page's own requireSession is not repeated)", async () => {
  const client = new Proxy({}, { get() { throw new Error("runBillsList re-checked the session"); } });
  const db = fakeDb({ tblbills: BILLS, tblbilllines: LINES });
  await runBillsList({ db, now: NOW, client, session: Promise.resolve(STAFF) });
  // Without a session it still checks, with the injected client (a null session client redirects / throws).
  await assert.rejects(runBillsList({ db, now: NOW, client }));
});

test("dashboard path: loadOpenBills without output makes the one tblbills read and adds no output field", async () => {
  const db = fakeDb({ tblbills: BILLS, tblbilllines: LINES });
  const groups = await loadOpenBills(db, "2026-09-12");
  assert.deepEqual(db.calls.filter((c) => c[1] === "select").map((c) => c[0]), ["tblbills"]);
  for (const g of groups) for (const r of g.rows) assert.equal("output" in r, false);
});

test("notice key collision lookup is scoped to the bill's case", async () => {
  const key = `bills/${CASE}/Bill${CASE} Invented 9207 SecondNotice.pdf`;
  const bill = { billid: 9207, billcaseid: CASE, billpdfpath: KEY(9207), billnotice: "2nd" };
  const read = async () => { throw new Error("READ"); }; // reached only once the key is judged free
  const other = fakeDb({ tblbills: [{ billid: 1, billcaseid: CASE + 1, billpdfpath: key }] });
  await assert.rejects(saveNoticePdf(other, bill, read, async () => {}), /READ/);
  assert.ok(other.calls.some((c) => c[1] === "eq" && c[2] === "billcaseid" && c[3] === CASE));
  const same = fakeDb({ tblbills: [{ billid: 2, billcaseid: CASE, billpdfpath: key }] });
  await assert.rejects(saveNoticePdf(same, bill, read, async () => {}), (e) => e.code === "notice-key" || /notice-key/.test(String(e.code ?? e.message)));
});

// --- pdf-lib stays out of the pages that only list bills --------------------------------------------------------
function reaches(entry, needle) {
  const seen = new Set(), stack = [resolve(ROOT, entry)];
  while (stack.length) {
    const f = stack.pop();
    if (seen.has(f)) continue;
    seen.add(f);
    const src = readFileSync(f, "utf8");
    for (const m of src.matchAll(/(?:import|export)\s[^;]*?from\s+["']([^"']+)["']|import\s*\(?\s*["']([^"']+)["']/g)) {
      const spec = m[1] ?? m[2];
      if (spec === needle) return f;
      const base = spec.startsWith("@/") ? join(ROOT, spec.slice(2)) : spec.startsWith(".") ? resolve(dirname(f), spec) : null;
      if (!base) continue;
      const hit = ["", ".ts", ".tsx", "/index.ts", "/index.tsx"].map((x) => base + x).find((p) => existsSync(p) && !p.endsWith("/") && /\.tsx?$/.test(p));
      if (hit) stack.push(hit);
    }
  }
  return null;
}
for (const entry of ["app/bills/page.tsx", "app/bills/bills-list-view.tsx", "lib/bills/list.ts", "lib/bills/output.ts", "app/bills/bills-panel.tsx", "app/dashboard/page.tsx", "lib/reports/dashboard.ts"]) {
  test(`${entry} does not import pdf-lib`, () => {
    assert.ok(existsSync(join(ROOT, entry)), `${entry} exists`);
    assert.equal(reaches(entry, "pdf-lib"), null);
  });
}
test("the import walker does find pdf-lib where it is used", () => {
  assert.notEqual(reaches("lib/bills/send.ts", "pdf-lib"), null);
});
