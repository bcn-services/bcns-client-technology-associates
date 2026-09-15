// Check → bill link (tblfundsrcvd.fndsbillid): pay writes it (link first, then bill, compensation on a lost bill write),
// edit never touches it, reversal copies it, the bills panel lists linked checks. Shared fakedb: filters every row,
// awaited hook(op, table, tables) for interleaving. Decoys per filter:
//   link write  (fndsid = F, fndsbillid is null): G = other id, unlinked; F itself re-linked meanwhile (hook).
//   bill write  (billid, billcaseid, billnotice):  15 = same case + notice, other id; 12 = other notice.
//   compensation (fndsid = F, fndsbillid = N):     H = other id, linked to N; F re-pointed meanwhile (hook).
import { test } from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { fakeDb } from "./fakedb.mjs";
import { runPayBill } from "../../lib/funds/pay.ts";
import { runUpdateFunds } from "../../lib/funds/save.ts";
import { runReverseFunds, reopenPreselect } from "../../lib/funds/reverse.ts";
import { listBillChecks } from "../../lib/funds/case.ts";

globalThis.React = React;
const { BillsPanelView } = await import("../../app/bills/bills-panel.tsx");

const CASE = 990960;
const funds = (fndsid, fndsbillid, o = {}) => ({
  fndsid, fndscaseid: CASE, fndsdate: `2026-08-0${fndsid}`, fndspmt: "450.00", fndsbillid, fndstype: "Check", fndspayee: "Acme",
  fndssource: null, fndsdesc: null, fndsbranch: "Stratford", fndscomment: null, fndssafilename: null, fndsbillfilename: null,
  fndsbankaccount: "BoA", fndsclearedbank: false, fndsdatecleared: null, fndsclearingnotes: null, ...o,
});
const bill = (billid, billnotice, o = {}) => ({
  billid, billcaseid: CASE, billnotice, billdate: `2026-07-${billid}`, billbalance: "450.00", billtype: "timesheet",
  billpaiddate: null, billsecondnoticedate: null, billfinalnoticedate: null, ...o,
});
// F=1 unlinked (the payer), G=2 unlinked, H=3 already linked to 11 (earlier partial payment).
const tables = () => ({
  tblfundsrcvd: [funds(1, null), funds(2, null), funds(3, 11)],
  tblbills: [bill(11, "Partial Payment"), bill(12, "2nd"), bill(14, "1st", { billcaseid: 990961 }), bill(15, "Partial Payment")],
  tblcase: [{ caseid: CASE }],
});
const form = (b, kind) => { const f = new FormData(); f.set("bill", b); f.set("kind", kind); return f; };
function deps(db, role = "admin") {
  const d = { redirected: null, revalidated: [] };
  d.session = async () => ({ userId: "u", email: "e", role, personId: 1 });
  d.db = () => db;
  d.now = () => new Date("2026-09-14T15:00:00Z");
  d.revalidatePath = (p) => d.revalidated.push(p);
  d.redirect = (u) => { d.redirected = u; };
  return d;
}
const snap = (x) => JSON.parse(JSON.stringify(x));
const f = (db, id) => db.tables.tblfundsrcvd.find((r) => r.fndsid === id);
const b = (db, id) => db.tables.tblbills.find((r) => r.billid === id);
const writes = (db) => db.calls.filter(([op]) => op === "update" || op === "insert").map(([op, t]) => `${op} ${t}`);

test("Mark bill paid: F linked to 11, bill 11 Paid on F's date; link written before the bill; G/H untouched", async () => {
  const db = fakeDb(tables());
  const before = snap(db.tables);
  const d = deps(db);
  await runPayBill(1, form("11:Partial Payment", "paid"), d);
  assert.equal(d.redirected, "/funds/1?paid=11");
  assert.deepEqual(f(db, 1), { ...before.tblfundsrcvd[0], fndsbillid: 11 });
  assert.deepEqual(f(db, 2), before.tblfundsrcvd[1], "G (unlinked decoy) untouched");
  assert.deepEqual(f(db, 3), before.tblfundsrcvd[2]);
  assert.deepEqual(b(db, 11), { ...before.tblbills[0], billnotice: "Paid", billpaiddate: "2026-08-01" });
  for (const id of [12, 14, 15]) assert.deepEqual(b(db, id), before.tblbills.find((x) => x.billid === id), `bill ${id} untouched`);
  assert.deepEqual(writes(db), ["update tblfundsrcvd", "update tblbills"]);
});

test("Record partial payment links too; a second check marking the same bill paid is also linked → bill lists both", async () => {
  const db = fakeDb(tables());
  await runPayBill(1, form("15:Partial Payment", "partial"), deps(db));
  assert.equal(f(db, 1).fndsbillid, 15);
  assert.equal(b(db, 15).billnotice, "Partial Payment");
  const d = deps(db);
  await runPayBill(2, form("15:Partial Payment", "paid"), d);
  assert.equal(d.redirected, "/funds/2?paid=15");
  assert.equal(b(db, 15).billnotice, "Paid");
  assert.equal(b(db, 15).billpaiddate, "2026-08-02");
  assert.deepEqual((await listBillChecks(db, [15])).map((c) => c.fndsid), [1, 2]);
});

test("paying from an already-linked row → linked; neither the bill nor the row changes; no write at all", async () => {
  const db = fakeDb(tables());
  const before = snap(db.tables);
  const d = deps(db);
  await runPayBill(3, form("15:Partial Payment", "paid"), d);
  assert.equal(d.redirected, "/funds/3?payerror=linked");
  assert.deepEqual(db.tables, before);
  assert.deepEqual(writes(db), []);
});

for (const [label, second] of [["same bill", "11:Partial Payment"], ["different bills", "15:Partial Payment"]]) {
  test(`two concurrent pay submits from one row (${label}), both past the read → exactly one link, one bill update`, async () => {
    let arrived = 0, release;
    const gate = new Promise((r) => { release = r; });
    const db = fakeDb(tables(), {
      hook: async (op, t) => { if (op === "update" && t === "tblfundsrcvd" && arrived < 2) { if (++arrived === 2) release(); await gate; } },
    });
    const before = snap(db.tables);
    const [d1, d2] = [deps(db), deps(db)];
    await Promise.all([runPayBill(1, form("11:Partial Payment", "paid"), d1), runPayBill(1, form(second, "paid"), d2)]);
    assert.equal(arrived, 2, "both requests reached the link write");
    assert.deepEqual([d1.redirected, d2.redirected].map((u) => u.replace(/=\d+$/, "=N")).sort(), ["/funds/1?paid=N", "/funds/1?payerror=linked"]);
    const won = Number(/paid=(\d+)/.exec(d1.redirected + d2.redirected)[1]);
    assert.equal(f(db, 1).fndsbillid, won);
    assert.equal(db.calls.filter(([op, t]) => op === "update" && t === "tblbills").length, 1, "one bill update");
    assert.equal(db.tables.tblbills.filter((x) => x.billnotice === "Paid").length, 1);
    assert.equal(b(db, won).billnotice, "Paid");
    assert.deepEqual(f(db, 2), before.tblfundsrcvd[1]);
    assert.deepEqual(f(db, 3), before.tblfundsrcvd[2]);
  });
}

test("row linked elsewhere between read and link write → linked; bill untouched; the other link stands", async () => {
  const db = fakeDb(tables(), { hook: async (op, t, tb) => { if (op === "update" && t === "tblfundsrcvd") tb.tblfundsrcvd[0].fndsbillid = 12; } });
  const d = deps(db);
  await runPayBill(1, form("11:Partial Payment", "paid"), d);
  assert.equal(d.redirected, "/funds/1?payerror=linked");
  assert.equal(f(db, 1).fndsbillid, 12);
  assert.equal(b(db, 11).billnotice, "Partial Payment");
});

test("bill notice moved (stale) → link compensated back to null; H's link to the same bill kept; bill unchanged", async () => {
  const db = fakeDb(tables());
  b(db, 11).billnotice = "2nd";
  const before = snap(db.tables);
  const d = deps(db);
  await runPayBill(1, form("11:Partial Payment", "paid"), d);
  assert.equal(d.redirected, "/funds/1?payerror=stale");
  assert.deepEqual(db.tables, before, "F back to unlinked, H still linked to 11, bill 11 unchanged");
  assert.deepEqual(writes(db), ["update tblfundsrcvd", "update tblbills", "update tblfundsrcvd"]);
});

test("compensation is guarded by the value it wrote: F re-pointed before the undo → failed, F keeps the other link", async () => {
  let n = 0;
  const db = fakeDb(tables(), {
    hook: async (op, t, tb) => { if (op === "update" && t === "tblfundsrcvd" && ++n === 2) tb.tblfundsrcvd[0].fndsbillid = 15; },
  });
  b(db, 11).billnotice = "2nd";
  const d = deps(db);
  const err = console.error; console.error = () => {};
  try { await runPayBill(1, form("11:Partial Payment", "paid"), d); } finally { console.error = err; }
  assert.equal(d.redirected, "/funds/1?payerror=failed");
  assert.equal(f(db, 1).fndsbillid, 15);
  assert.equal(f(db, 3).fndsbillid, 11);
});

test("QA: bill write returns an error → link undone (F unlinked), bill unchanged, failed", async () => {
  const db = fakeDb(tables());
  const before = snap(db.tables);
  const errDb = { ...db, from(t) {
    const q = db.from(t);
    if (t === "tblbills") { const upd = q.update; q.update = (p) => { upd(p); q.then = (res) => Promise.resolve({ data: null, error: { message: "boom" } }).then(res); return q; }; }
    return q;
  } };
  const d = deps(errDb);
  const err = console.error; console.error = () => {};
  try { await runPayBill(1, form("11:Partial Payment", "paid"), d); } finally { console.error = err; }
  assert.equal(d.redirected, "/funds/1?payerror=failed");
  assert.deepEqual(db.tables, before, "F back to unlinked; H keeps its link; bills unchanged");
});

test("bill on another case → bill, refused before either write", async () => {
  const db = fakeDb(tables());
  const before = snap(db.tables);
  const d = deps(db);
  await runPayBill(1, form("14:1st", "paid"), d);
  assert.equal(d.redirected, "/funds/1?payerror=bill");
  assert.deepEqual(db.tables, before);
  assert.deepEqual(writes(db), []);
});

test("funds edit of a linked row never changes fndsbillid", async () => {
  const db = fakeDb(tables());
  const fd = new FormData();
  for (const [k, v] of Object.entries({ case: String(CASE), amount: "500.00", date: "2026-08-09", branch: "Stratford" })) fd.set(k, v);
  const d = deps(db);
  await runUpdateFunds(3, fd, d);
  assert.equal(d.redirected, "/funds/3?saved=1");
  assert.equal(f(db, 3).fndspmt, "500.00");
  assert.equal(f(db, 3).fndsbillid, 11);
});

test("reversing a linked check: reopen preselects its bill; reversal row carries fndsbillid; original byte-identical", async () => {
  const db = fakeDb(tables());
  b(db, 11).billnotice = "Paid";
  assert.equal(reopenPreselect([{ billid: 11 }, { billid: 15 }], 11), "11");
  assert.equal(reopenPreselect([{ billid: 15 }], 11), "", "linked bill not Paid → No bill");
  assert.equal(reopenPreselect([{ billid: 11 }], null), "");
  const orig = snap(f(db, 3));
  const d = deps(db);
  await runReverseFunds(3, (() => { const x = new FormData(); x.set("bill", "11"); return x; })(), d);
  assert.equal(d.redirected, "/funds/3?reversed=-3");
  assert.deepEqual(f(db, 3), orig);
  assert.equal(f(db, -3).fndsbillid, 11);
  assert.equal(f(db, -3).fndspmt, "-450.00");
  assert.deepEqual((await listBillChecks(db, [11])).map((c) => c.fndsid).sort(), [-3, 3]);
});

test("listBillChecks: only rows linked to the given bills; bills panel lists each bill's checks (reversals too) in its own list", async () => {
  const db = fakeDb({ tblfundsrcvd: [funds(1, 11), funds(2, 12), funds(3, null), funds(-1, 11, { fndspmt: "-450.00", fndsdate: "2026-09-14" })] });
  const checks = await listBillChecks(db, [11]);
  assert.deepEqual(checks.map((c) => [c.fndsid, c.amount]), [[1, "450.00"], [-1, "-450.00"]]);
  assert.deepEqual(await listBillChecks(fakeDb({}), []), []);
  const bills = [bill(12, "2nd"), bill(11, "Paid", { billpaiddate: "2026-08-01" })];
  const html = renderToStaticMarkup(BillsPanelView({ caseId: CASE, bills, admin: false, checks: await listBillChecks(db, [11, 12]) }));
  const list = /<ul aria-label="Applied checks" data-testid="bill-checks"[^>]*>(.*?)<\/ul>/.exec(html)[1];
  const items = [...list.matchAll(/<li data-testid="bill-check" data-billid="(\d+)">(.*?)<\/li>/g)].map((m) => [m[1], m[2]]);
  assert.equal(items.length, 3);
  assert.ok(items.some(([bid, h]) => bid === "11" && h.includes('href="/funds/1"') && h.includes("2026-08-01 · $450.00")));
  assert.ok(items.some(([bid, h]) => bid === "11" && h.includes('href="/funds/-1"') && h.includes("2026-09-14 · $-450.00")));
  assert.ok(items.some(([bid, h]) => bid === "12" && h.includes('href="/funds/2"')));
  const rows = [...html.matchAll(/<tr data-testid="case-bill"[^>]*>(.*?)<\/tr>/g)].map((m) => m[1]);
  for (const r of rows) assert.equal((r.match(/<a /g) ?? []).length, 1, "each bill row keeps exactly one link");
  assert.doesNotMatch(renderToStaticMarkup(BillsPanelView({ caseId: CASE, bills, admin: false })), /bill-checks/);
});
