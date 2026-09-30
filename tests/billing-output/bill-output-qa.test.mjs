// Item 8 QA (independent of bill-output.test.mjs): the case Bills panel and /bills against an exhaustive matrix of
// bill shapes, with an oracle written from LANE.md item 8 + the rule docs (not from lib/bills/output.ts), and legacy /
// mixed-case markup captured by QA from the HEAD 7801e70 tree (fixtures/i8-qa-head-markup.json). Fake PostgREST applies
// eq / in / order / range, so paged reads are exercised. All names and figures are invented.
import { test } from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { join } from "node:path";

globalThis.React = React; // tsx compiles .tsx with the classic JSX runtime
const { BillsPanel } = await import("../../app/bills/bills-panel.tsx");
const { BillsListView } = await import("../../app/bills/bills-list-view.tsx");
const { runBillsList } = await import("../../lib/bills/list.ts");

const ROOT = new URL("../..", import.meta.url).pathname;
const HEAD = JSON.parse(readFileSync(join(ROOT, "tests/billing-output/fixtures/i8-qa-head-markup.json"), "utf8"));
const NOW = new Date("2026-09-12T16:00:00Z"); // firm today 2026-09-12, the date the HEAD markup used
const S = { admin: { role: "admin" }, staff: { role: "staff" } };

function fakeDb(tables) {
  return {
    from(table) {
      const q = { f: [], o: [], r: null };
      const b = new Proxy({}, {
        get(_, k) {
          if (k === "then") {
            let rows = (tables[table] ?? []).filter((r) => q.f.every((f) => f(r))).map((r) => ({ ...r }));
            for (const [c, asc] of [...q.o].reverse()) rows = [...rows].sort((x, y) => (x[c] < y[c] ? -1 : x[c] > y[c] ? 1 : 0) * (asc ? 1 : -1));
            if (q.r) rows = rows.slice(q.r[0], q.r[1] + 1);
            return (res, rej) => Promise.resolve({ data: rows, error: null }).then(res, rej);
          }
          return (...a) => {
            if (k === "eq") q.f.push((r) => r[a[0]] === a[1]);
            else if (k === "in") q.f.push((r) => a[1].includes(r[a[0]]));
            else if (k === "order") q.o.push([a[0], a[1]?.ascending !== false]);
            else if (k === "range") q.r = a;
            else if (k !== "select") throw new Error(`fake db: unsupported ${k}`);
            return b;
          };
        },
      });
      return b;
    },
  };
}
const panel = async (tables, caseId, who) => renderToStaticMarkup(await BillsPanel({ caseId, db: fakeDb(tables), session: S[who] }));
const list = async (tables, who) => renderToStaticMarkup(React.createElement(BillsListView, {
  groups: await runBillsList({ db: fakeDb(tables), now: NOW, session: Promise.resolve(S[who]) }), admin: who === "admin",
}));
const count = (html, s) => html.split(s).length - 1;

// --- exhaustive matrix ------------------------------------------------------------------------------------------
const NOTICES = ["1st", "2nd", "Final", "Partial Payment", "Deadbeat", "Paid", "Cancelled", "Carried Over", "Settled", "Credit", "Refund"];
const OPEN = new Set(["1st", "2nd", "Final", "Partial Payment", "Deadbeat"]);
const CLOSED = new Set(["Cancelled", "Carried Over", "Settled"]); // never billed again
const CASE = 990920;
const SENT_AT = "2026-09-15T02:00:00Z"; // 22:00 on Sept 14 in the firm's zone (America/New_York)
const bills = [], lines = [], want = new Map();
let id = 20000;
for (const billtype of [null, "timesheet"]) for (const billnotice of NOTICES) for (const fin of [false, true]) for (const pdf of [false, true])
  for (const sent of [false, true]) for (const revised of [false, true]) for (const broken of [false, true]) {
    const billid = ++id;
    bills.push({
      billid, billcaseid: CASE, billdate: `2026-0${1 + (billid % 8)}-1${billid % 10}`, billtype, billnotice, billhours: 1.5, billbalance: 300,
      billsecondnoticedate: null, billfinalnoticedate: null, billpaiddate: null, billfilename: `Bill${CASE} Invented ${billid}`,
      billfinalizedat: fin ? "2026-09-01T15:00:00Z" : null, billpdfpath: pdf ? `bills/${CASE}/Bill${CASE} Invented ${billid}.pdf` : null,
      billsentat: sent ? SENT_AT : null, supersedesbillid: null, tblcase: { caseid: CASE },
    });
    // 12 saved lines per bill (0.125 h / $25 each = 1.5 h / $300); a broken bill is missing its last line.
    if (billtype && fin) for (let n = 1; n <= (broken ? 11 : 12); n++)
      lines.push({ billid, lineno: n, kind: "charge", linedate: "2026-08-20", description: "Invented work", personid: null, hours: "0.125", rate: "200.00", amount: "25.00" });
    if (revised) { // its revision: another typed bill on the case, closed as Credit (not on the unpaid list, not finalizable-relevant)
      const rid = ++id;
      bills.push({ ...bills.at(-1), billid: rid, billtype: "timesheet", billnotice: "Credit", billfinalizedat: null, billpdfpath: null, billsentat: null, supersedesbillid: billid, billfilename: null });
      want.set(rid, { legacy: false, notice: "Credit", state: "Draft", download: false, finalize: true, send: false, sendNotice: false, sent: false });
    }
    const typed = billtype != null;
    want.set(billid, {
      legacy: !typed, notice: billnotice,
      state: sent ? "Sent 2026-09-14" : fin ? "Finalized" : "Draft",
      download: typed && pdf,
      finalize: typed && !fin && !revised && !CLOSED.has(billnotice),
      send: typed && fin && pdf && !(broken && fin) && !CLOSED.has(billnotice),
      sendNotice: typed && fin && pdf && (billnotice === "2nd" || billnotice === "Final"),
      sent,
    });
  }
const T = { tblbills: bills, tblbilllines: lines, tblfundsrcvd: [] };

test("matrix is big enough to page the saved-lines read (more than 1000 lines)", () => {
  assert.ok(lines.length > 1000, `${lines.length} lines`);
  assert.ok(bills.length > 700);
});

const panelRow = (html, id) => html.match(new RegExp(`<li data-testid="bill-output-row" data-billid="${id}"[^>]*>(.*?)</li>`))?.[1];
const listRow = (html, id) => html.match(new RegExp(`<tr data-testid="open-bill"[^>]*>((?:(?!</tr>).)*href="/bills/${id}"(?:(?!</tr>).)*)</tr>`))?.[1];

for (const who of ["admin", "staff"]) {
  test(`case panel (${who}): every bill's state and each action exactly where its rule allows, nowhere else`, async () => {
    const html = await panel(T, CASE, who);
    const admin = who === "admin";
    for (const [bid, w] of want) {
      const row = panelRow(html, bid);
      if (w.legacy) { assert.equal(row, undefined, `legacy ${bid} gets no output line`); }
      else {
        assert.ok(row, `typed ${bid} has an output line`);
        assert.match(row, new RegExp(`data-testid="bill-state"[^>]*>${w.state}<`), `${bid} state`);
      }
      assert.equal(count(html, `href="/bills/${bid}/pdf"`), +w.download, `${bid} download`);
      assert.equal(count(html, `href="/bills/${bid}/finalize"`), +(admin && w.finalize), `${bid} finalize`);
      assert.equal(count(html, `href="/bills/${bid}/send`), +(admin && w.send), `${bid} send`);
      if (admin && w.send) assert.match(row, w.sent ? new RegExp(`/send\\?again=1"[^>]*>Send again<`) : new RegExp(`/send"[^>]*>Send<`), `${bid} send label`);
      assert.equal(count(html, `href="/bills/${bid}/notice"`), +(admin && w.sendNotice), `${bid} send notice`);
      if (admin && w.sendNotice) assert.match(row, new RegExp(`>Send ${w.notice} notice<`));
    }
  });

  test(`/bills (${who}): open bills only; state + Download per bill; Finalize / Send / Send notice only for an admin, per rule`, async () => {
    const html = await list(T, who);
    const admin = who === "admin";
    for (const [bid, w] of want) {
      const row = listRow(html, bid);
      if (!OPEN.has(w.notice)) { assert.equal(row, undefined, `${bid} (${w.notice}) is not on the unpaid list`); assert.equal(count(html, `/bills/${bid}/`), 0); continue; }
      assert.ok(row, `open ${bid} is listed`);
      if (w.legacy) assert.doesNotMatch(row, /data-testid="bill-(state|download|finalize|send)"/, `legacy ${bid} unchanged`);
      else assert.match(row, new RegExp(`data-testid="bill-state"[^>]*>${w.state}<`), `${bid} state`);
      assert.equal(count(html, `href="/bills/${bid}/pdf"`), +w.download, `${bid} download`);
      assert.equal(count(html, `href="/bills/${bid}/finalize"`), +(admin && w.finalize), `${bid} finalize`);
      assert.equal(count(html, `href="/bills/${bid}/send`), +(admin && w.send), `${bid} send`);
      assert.equal(count(html, `href="/bills/${bid}/notice"`), +(admin && w.sendNotice), `${bid} send notice (one column, not duplicated)`);
    }
    if (!admin) assert.doesNotMatch(html, /\/finalize"|\/send"|\/send\?|\/notice"|notice-blocked/);
  });
}

// --- legacy and mixed cases: identical to the HEAD markup ---------------------------------------------------------
const LEG = 990911, MIX = 990912;
const headT = (rows) => ({ tblbills: rows, tblbilllines: HEAD.lines, tblfundsrcvd: [] });
// Strip exactly what item 8 adds: the panel's Bill output list, and the state / Download / Finalize / Send links in /bills rows.
const stripPanel = (h) => h.replace(/<ul aria-label="Bill output"[^>]*>.*?<\/ul>/, "");
const stripList = (h) => h.replace(/<(a|span)\b[^>]*data-testid="bill-(?:state|download|finalize|send)"[^>]*>[^<]*<\/\1>/g, "");

for (const who of ["admin", "staff"]) {
  test(`legacy-only case (${who}): panel and /bills byte-identical to HEAD, incl. legacy rows that carry a PDF path or sent stamp`, async () => {
    assert.equal(await panel(headT(HEAD.legacy), LEG, who), HEAD.markup[`legacy-panel-${who}`]);
    assert.equal(await list(headT(HEAD.legacy), who), HEAD.markup[`legacy-list-${who}`]);
  });

  test(`mixed case (${who}): legacy rows untouched; the only additions are item 8's output elements`, async () => {
    const p = await panel(headT(HEAD.mixed), MIX, who);
    assert.equal(stripPanel(p), HEAD.markup[`mixed-panel-${who}`]);
    for (const b of HEAD.mixed.filter((x) => x.billtype == null)) {
      assert.equal(p.includes(`data-billid="${b.billid}"`) && p.includes(`<li data-testid="bill-output-row" data-billid="${b.billid}"`), false);
      assert.equal(p.includes(`/bills/${b.billid}/pdf`), false, `legacy ${b.billid} gets no Download even with a PDF path`);
    }
    const l = await list(headT(HEAD.mixed), who);
    assert.equal(stripList(l), HEAD.markup[`mixed-list-${who}`]);
    for (const b of HEAD.mixed.filter((x) => x.billtype == null && OPEN.has(x.billnotice))) {
      const row = listRow(l, b.billid);
      assert.ok(row && HEAD.markup[`mixed-list-${who}`].includes(row), `legacy row ${b.billid} byte-identical`);
    }
    // and the typed bills did get their output (the strip is not hiding a missing feature)
    assert.match(p, /data-billid="9402"[^>]*><span>2026-09-09 timesheet:<\/span><span data-testid="bill-state"[^>]*>Finalized</);
    assert.match(l, /href="\/bills\/9403\/pdf"/);
  });
}

// --- no re-derivation in the UI ---------------------------------------------------------------------------------
test("the panel and /bills view read eligibility only from the output object, never from bill columns", () => {
  for (const f of ["app/bills/bills-panel.tsx", "app/bills/bills-list-view.tsx"]) {
    const src = readFileSync(join(ROOT, f), "utf8");
    assert.doesNotMatch(src, /billfinalizedat|billpdfpath|billsentat|supersedesbillid|NEVER_BILLED|canFinalizeBill|canSendBill/, f);
  }
  const out = readFileSync(join(ROOT, "lib/bills/output.ts"), "utf8");
  assert.match(out, /import \{[^}]*canFinalizeBill[^}]*canSendBill[^}]*canSendNotice[^}]*\} from "\.\/rules"/);
});
