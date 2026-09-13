// Unit tests for the case-page Bills panel (lib/bills/case.ts + app/bills/bills-panel.tsx), driven through the real
// BillsPanel with an injected db + session. Fake PostgREST (pattern: tests/cases/create.test.mjs) APPLIES eq/order,
// so dropping the case filter or flipping an order changes what comes back. Expected values are written-out literals.
import { test } from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

globalThis.React = React; // tsx compiles .tsx with the classic JSX runtime
const { BillsPanel } = await import("../../app/bills/bills-panel.tsx");

function fakeDb(tables, { fail } = {}) {
  const calls = [];
  return {
    calls,
    from(table) {
      const q = { filters: [], orders: [] };
      const b = new Proxy({}, {
        get(_, k) {
          if (k === "then") {
            if (fail === table) return (res, rej) => Promise.resolve({ data: null, error: { message: "boom" } }).then(res, rej);
            let rows = (tables[table] ?? []).filter((r) => q.filters.every((f) => f(r))).map((r) => ({ ...r }));
            for (const [col, asc] of [...q.orders].reverse()) rows = [...rows].sort((x, y) => (x[col] < y[col] ? -1 : x[col] > y[col] ? 1 : 0) * (asc ? 1 : -1));
            return (res, rej) => Promise.resolve({ data: rows, error: null }).then(res, rej);
          }
          return (...a) => {
            calls.push([table, k, ...a]);
            if (k === "eq") q.filters.push((r) => r[a[0]] === a[1]);
            if (k === "order") q.orders.push([a[0], a[1]?.ascending !== false]);
            return b;
          };
        },
      });
      return b;
    },
  };
}

const CASE = 990801;
const bill = (billid, billnotice, billdate, o = {}) => ({
  billid, billcaseid: CASE, billdate, billnotice, billtype: "timesheet", billhours: 2, billbalance: 100,
  billsecondnoticedate: null, billfinalnoticedate: null, billpaiddate: null, ...o,
});
const tblcase = [{ caseid: CASE, casetitle: "Invented 990801", numunpaidbills: 5 }];
const ADMIN = { role: "admin" };
const STAFF = { role: "staff" };

const panel = async (bills, { session = ADMIN, fail } = {}) => {
  const db = fakeDb({ tblbills: bills, tblcase }, { fail });
  const html = renderToStaticMarkup(await BillsPanel({ caseId: CASE, db, session }));
  return { db, html };
};
const text = (h) => h.replace(/<[^>]+>/g, " ").replace(/&[a-z#0-9]+;/g, " ").replace(/\s+/g, " ").trim();
const rows = (h) => [...h.matchAll(/<tr data-testid="case-bill"[^>]*>(.*?)<\/tr>/g)].map((m) => m[1]);
const rowFor = (h, billid) => rows(h).find((r) => r.includes(`href="/bills/${billid}"`));
const testid = (h, id) => { const m = h.match(new RegExp(`data-testid="${id}"[^>]*>([^<]*)<`)); assert.ok(m, `${id} present`); return m[1]; };

// Three bills on the case, stored out of order, one legacy; plus a bill on another case that must not show.
const THREE = [
  bill(811, "1st", "2026-08-01", { billbalance: 450 }),
  bill(812, "Paid", "2019-03-04", { billtype: null, billhours: 0, billbalance: 75.5 }), // legacy
  bill(813, "2nd", "2026-09-01", { billtype: "depo", billbalance: 1234.5, billsecondnoticedate: "2026-09-10" }),
  bill(899, "1st", "2026-09-11", { billcaseid: 990899 }),
];

test("three bills (one legacy: billtype null, billhours 0, Paid) list newest first, each with balance, status and bill link", async () => {
  const { html } = await panel(THREE);
  assert.deepEqual(rows(html).map((r) => r.match(/href="\/bills\/(\d+)"/)[1]), ["813", "811", "812"]);
  assert.equal(text(rowFor(html, 813)), "2026-09-01 depo 1234.50 2nd");
  assert.equal(text(rowFor(html, 811)), "2026-08-01 timesheet 450.00 1st");
  assert.equal(text(rowFor(html, 812)), "2019-03-04 75.50 Paid");
  assert.doesNotMatch(html, /null|undefined/);
});

test("same-day tie: the higher billid lists first", async () => {
  const { html } = await panel([bill(821, "1st", "2026-08-01"), bill(822, "Paid", "2026-08-01"), bill(820, "1st", "2026-07-01")]);
  assert.deepEqual(rows(html).map((r) => r.match(/href="\/bills\/(\d+)"/)[1]), ["822", "821", "820"]);
});

test("1st + Deadbeat + Paid with tblcase.numunpaidbills = 5 → unpaid-bill-count 2; loader never reads tblcase or numunpaidbills", async () => {
  const { db, html } = await panel([bill(831, "1st", "2026-08-01"), bill(832, "Deadbeat", "2026-07-01"), bill(833, "Paid", "2026-06-01")]);
  assert.equal(testid(html, "unpaid-bill-count"), "2");
  assert.deepEqual([...new Set(db.calls.map((c) => c[0]))], ["tblbills"]);
  assert.doesNotMatch(JSON.stringify(db.calls), /numunpaidbills/);
});

test("every open status counts (2nd, Final, Partial Payment) and closed ones do not (Cancelled, Carried Over, Settled, Credit, Refund)", async () => {
  const open = ["2nd", "Final", "Partial Payment"].map((n, i) => bill(840 + i, n, "2026-08-01"));
  const closed = ["Cancelled", "Carried Over", "Settled", "Credit", "Refund"].map((n, i) => bill(850 + i, n, "2026-08-01"));
  assert.equal(testid((await panel([...open, ...closed])).html, "unpaid-bill-count"), "3");
});

test("notice dates come from the newest OPEN bill, not the newest bill (a newer Paid bill carries its own dates)", async () => {
  const { html } = await panel([
    bill(861, "Paid", "2026-09-05", { billsecondnoticedate: "2026-09-06", billfinalnoticedate: "2026-09-07" }),
    bill(862, "Final", "2026-06-01", { billsecondnoticedate: "2026-07-01", billfinalnoticedate: "2026-08-01" }),
    bill(863, "2nd", "2026-04-01", { billsecondnoticedate: "2026-05-01" }),
  ]);
  assert.equal(testid(html, "second-notice-date"), "2026-07-01");
  assert.equal(testid(html, "final-notice-date"), "2026-08-01");
});

test("latest open bill with only a 2nd notice → final-notice-date empty; same-day tie picks the higher billid", async () => {
  const { html } = await panel([
    bill(871, "Final", "2026-08-01", { billsecondnoticedate: "2026-08-02", billfinalnoticedate: "2026-08-03" }),
    bill(872, "2nd", "2026-08-01", { billsecondnoticedate: "2026-08-20" }),
  ]);
  assert.equal(testid(html, "second-notice-date"), "2026-08-20");
  assert.equal(testid(html, "final-notice-date"), "");
});

test("latest open bill is a 1st with no notice dates → both testids empty even though an older open bill has dates", async () => {
  const { html } = await panel([
    bill(881, "1st", "2026-09-01"),
    bill(882, "Final", "2026-05-01", { billsecondnoticedate: "2026-06-01", billfinalnoticedate: "2026-07-01" }),
  ]);
  assert.equal(testid(html, "unpaid-bill-count"), "2");
  assert.equal(testid(html, "second-notice-date"), "");
  assert.equal(testid(html, "final-notice-date"), "");
});

test("no open bill → count 0 and both notice testids empty, even when a Paid bill has notice dates", async () => {
  const { html } = await panel([bill(891, "Paid", "2026-09-01", { billsecondnoticedate: "2026-09-02", billfinalnoticedate: "2026-09-03" })]);
  assert.equal(testid(html, "unpaid-bill-count"), "0");
  assert.equal(testid(html, "second-notice-date"), "");
  assert.equal(testid(html, "final-notice-date"), "");
});

test("admin sees a New bill link to /bills/new?case=<id>; staff sees the panel without it", async () => {
  const admin = (await panel(THREE, { session: ADMIN })).html;
  const staff = (await panel(THREE, { session: STAFF })).html;
  assert.match(admin, /<a [^>]*href="\/bills\/new\?case=990801"[^>]*>New bill<\/a>/);
  assert.doesNotMatch(staff, /New bill|bills\/new/);
  assert.equal(rows(staff).length, 3, "staff still sees every bill");
  assert.match(staff, /<h2[^>]*>Bills<\/h2>/);
});

test("heading is exactly Bills, the only heading; no /billed/i anywhere (admin, staff, empty, failed read)", async () => {
  const renders = [
    (await panel(THREE, { session: ADMIN })).html,
    (await panel(THREE, { session: STAFF })).html,
    (await panel([], { session: ADMIN })).html,
    (await panel(THREE, { session: ADMIN, fail: "tblbills" })).html,
  ];
  for (const h of renders) {
    assert.deepEqual([...h.matchAll(/<h\d[^>]*>(.*?)<\/h\d>/g)].map((m) => m[1]), ["Bills"]);
    assert.doesNotMatch(h, /billed/i);
    assert.doesNotMatch(h, /<button|<input|<form/i);
  }
});

test("a failed read renders a note instead of throwing", async () => {
  const { html } = await panel(THREE, { fail: "tblbills" });
  assert.match(text(html), /Bills could not be loaded\./);
  assert.equal(rows(html).length, 0);
});

test("no bills → empty-state note, count 0", async () => {
  const { html } = await panel([bill(899, "1st", "2026-09-11", { billcaseid: 990899 })]);
  assert.match(text(html), /No bills on this case/);
  assert.equal(testid(html, "unpaid-bill-count"), "0");
});
