// Bills panel → "Record payment" → /funds/new?bill= → save → /funds/<id>?bill= preselect. Decoys: a second open bill
// (so N is not the oldest), a Paid bill and a foreign-case bill both passed as ?bill=.
import { test } from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { fakeDb } from "./fakedb.mjs";
import { runCreateFunds, billParam } from "../../lib/funds/save.ts";
import { openBillsOldestFirst, preselectBill } from "../../lib/funds/pay.ts";
import { listCaseBills } from "../../lib/bills/case.ts";

globalThis.React = React;
const { BillsPanelView } = await import("../../app/bills/bills-panel.tsx");

const CASE = 990950;
const bill = (billid, billnotice, billdate, o = {}) => ({
  billid, billcaseid: CASE, billdate, billnotice, billtype: "timesheet", billbalance: 100,
  billsecondnoticedate: null, billfinalnoticedate: null, billpaiddate: null, ...o,
});
const OLDEST = bill(901, "1st", "2026-06-01");
const N = bill(902, "2nd", "2026-07-01");
const PAID = bill(903, "Paid", "2026-05-01", { billpaiddate: "2026-08-15" });
const FOREIGN = bill(904, "1st", "2026-04-01", { billcaseid: 990951 });
// Stored newest first: fakedb's order() is a no-op, and listCaseBills' contract is newest first.
const tables = () => ({ tblbills: [N, OLDEST, PAID, FOREIGN].map((b) => ({ ...b })) });

const rows = (h) => [...h.matchAll(/<tr data-testid="case-bill"[^>]*>(.*?)<\/tr>/g)].map((m) => m[1]);
const rowFor = (h, id) => rows(h).find((r) => r.includes(`href="/bills/${id}"`));

test("listCaseBills returns billpaiddate; panel shows it for the Paid bill only, as stored", async () => {
  const bills = await listCaseBills(fakeDb(tables()), CASE);
  assert.equal(bills.find((b) => b.billid === 903).billpaiddate, "2026-08-15");
  assert.equal(bills.some((b) => b.billid === 904), false);
  const html = renderToStaticMarkup(BillsPanelView({ caseId: CASE, bills, admin: false }));
  assert.match(rowFor(html, 903), /data-testid="bill-paid-date"> 2026-08-15</);
  assert.doesNotMatch(rowFor(html, 902), /bill-paid-date/);
  // a non-Paid bill carrying a stale paid date does not show it
  const stale = renderToStaticMarkup(BillsPanelView({ caseId: CASE, bills: [{ ...N, billpaiddate: "2026-01-01" }], admin: true }));
  assert.doesNotMatch(stale, /2026-01-01/);
});

test("Record payment links: one per open bill, exact href, none for Paid, none inside case-bill rows, both roles", async () => {
  const bills = await listCaseBills(fakeDb(tables()), CASE);
  for (const admin of [true, false]) {
    const html = renderToStaticMarkup(BillsPanelView({ caseId: CASE, bills, admin }));
    const links = [...html.matchAll(/<a [^>]*href="([^"]*)"[^>]*>Record payment[^<]*<\/a>/g)].map((m) => m[1].replaceAll("&amp;", "&"));
    assert.deepEqual(links.sort(), [`/funds/new?case=${CASE}&bill=901`, `/funds/new?case=${CASE}&bill=902`]);
    for (const r of rows(html)) assert.doesNotMatch(r, /funds\/new/);
    assert.doesNotMatch(html, /billed/i);
    assert.doesNotMatch(html, /<button/);
  }
});

function form(over = {}) {
  const f = new FormData();
  for (const [k, v] of Object.entries({ case: String(CASE), amount: "450.00", date: "2026-09-14", branch: "Stratford", ...over })) f.set(k, v);
  return f;
}
const deps = (db) => {
  const d = { redirected: null };
  d.session = async () => ({ userId: "u", email: "e", role: "staff", personId: 1 });
  d.db = () => db; d.revalidatePath = () => {}; d.redirect = (u) => { d.redirected = u; };
  return d;
};
const withCase = () => ({ tblcase: [{ caseid: CASE }], tblfundsrcvd: [] });

test("runCreateFunds carries a numeric bill to the saved page and never into the insert", async () => {
  const db = fakeDb(withCase());
  const d = deps(db);
  await runCreateFunds(form({ bill: "902" }), d);
  assert.equal(d.redirected, "/funds/1?saved=1&bill=902");
  assert.equal(db.tables.tblfundsrcvd.length, 1);
  assert.equal("bill" in db.tables.tblfundsrcvd[0], false);
  assert.equal(Object.keys(db.tables.tblfundsrcvd[0]).some((k) => /bill/.test(k)), false);
});

test("runCreateFunds drops a non-numeric bill (success and error); error round-trip keeps a numeric one", async () => {
  for (const bad of ["abc", "902x", "-902", "0", "9.5", "1 OR 1=1", ""]) {
    const d = deps(fakeDb(withCase()));
    await runCreateFunds(form({ bill: bad }), d);
    assert.equal(d.redirected, "/funds/1?saved=1", bad);
    const e = deps(fakeDb(withCase()));
    await runCreateFunds(form({ bill: bad, amount: "x" }), e);
    assert.equal(new URLSearchParams(e.redirected.split("?")[1]).has("bill"), false, bad);
  }
  const e = deps(fakeDb(withCase()));
  await runCreateFunds(form({ bill: "902", amount: "x" }), e);
  const q = new URLSearchParams(e.redirected.split("?")[1]);
  assert.ok(e.redirected.startsWith("/funds/new?"));
  assert.equal(q.get("error"), "amount");
  assert.equal(q.get("bill"), "902");
  assert.equal(billParam("0902"), undefined);
});

test("preselect: N (not oldest) wins; Paid, foreign-case, junk and missing fall back to the oldest open bill", async () => {
  const open = await openBillsOldestFirst(fakeDb(tables()), CASE);
  assert.deepEqual(open.map((b) => b.billid), [901, 902]);
  assert.equal(preselectBill(open, "902").billid, 902);
  for (const want of ["903", "904", "abc", "", "0902", " 902"]) assert.equal(preselectBill(open, want).billid, 901, want);
  assert.equal(preselectBill([], "902"), undefined);
});
