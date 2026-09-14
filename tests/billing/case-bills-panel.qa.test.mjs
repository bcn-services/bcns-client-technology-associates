// QA: one test per guard for the case-page Bills panel, driven through the real BillsPanel + listCaseBills with an
// injected session and a fake PostgREST db. The fake APPLIES eq/neq/gt/gte/lt/lte/is/in/not/order/limit, projects the
// select list, supports single/maybeSingle, and THROWS on any other builder method — so a loader-side filter (e.g.
// .not("billtype","is",null) or .gt("billhours",0)) changes what comes back instead of being silently ignored.
// Each test's fixture is built so only its own guard can turn it red: tblcase.numunpaidbills equals the correct count
// everywhere except the numunpaidbills test; rows are located by content (date), never by href or DOM position.
import { test } from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

globalThis.React = React; // tsx compiles .tsx with the classic JSX runtime
const { BillsPanel } = await import("../../app/bills/bills-panel.tsx");

function fakeDb(tables) {
  return {
    from(table) {
      const q = { filters: [], orders: [], cols: null, one: null, limit: null };
      const run = () => {
        let rows = (tables[table] ?? []).filter((r) => q.filters.every((f) => f(r)));
        for (const [col, asc] of [...q.orders].reverse()) rows = [...rows].sort((x, y) => (x[col] < y[col] ? -1 : x[col] > y[col] ? 1 : 0) * (asc ? 1 : -1));
        if (q.limit != null) rows = rows.slice(0, q.limit);
        rows = rows.map((r) => (q.cols ? Object.fromEntries(q.cols.map((c) => [c, r[c]])) : { ...r }));
        if (q.one) return rows.length ? { data: rows[0], error: null } : q.one === "maybe" ? { data: null, error: null } : { data: null, error: { message: "no rows" } };
        return { data: rows, error: null };
      };
      const is = (v, want) => (want === null ? v == null : v === want);
      const ops = {
        select: (s = "*") => { q.cols = s.trim() === "*" ? null : s.split(",").map((c) => c.trim()); },
        eq: (c, v) => q.filters.push((r) => r[c] === v),
        neq: (c, v) => q.filters.push((r) => r[c] !== v),
        gt: (c, v) => q.filters.push((r) => r[c] != null && r[c] > v),
        gte: (c, v) => q.filters.push((r) => r[c] != null && r[c] >= v),
        lt: (c, v) => q.filters.push((r) => r[c] != null && r[c] < v),
        lte: (c, v) => q.filters.push((r) => r[c] != null && r[c] <= v),
        is: (c, v) => q.filters.push((r) => is(r[c], v)),
        in: (c, vs) => q.filters.push((r) => vs.includes(r[c])),
        not: (c, op, v) => q.filters.push((r) => !(op === "is" ? is(r[c], v) : op === "eq" ? r[c] === v : (() => { throw new Error(`fake db: not.${op}`); })())),
        order: (c, o) => q.orders.push([c, o?.ascending !== false]),
        limit: (n) => { q.limit = n; },
        single: () => { q.one = "single"; },
        maybeSingle: () => { q.one = "maybe"; },
      };
      const b = new Proxy({}, {
        get(_, k) {
          if (k === "then") return (res, rej) => Promise.resolve(run()).then(res, rej);
          if (!(k in ops)) throw new Error(`fake db: unsupported builder method ${String(k)}`);
          return (...a) => { ops[k](...a); return b; };
        },
      });
      return b;
    },
  };
}

const CASE = 991301;
const bill = (billid, billnotice, billdate, o = {}) => ({
  billid, billcaseid: CASE, billdate, billnotice, billtype: "timesheet", billhours: 2, billbalance: 100,
  billsecondnoticedate: null, billfinalnoticedate: null, billpaiddate: null, ...o,
});
const render = async (bills, { unpaid, role = "admin" } = {}) => {
  const db = fakeDb({ tblbills: bills, tblcase: [{ caseid: CASE, casetitle: "Invented 991301", numunpaidbills: unpaid ?? null }] });
  return renderToStaticMarkup(await BillsPanel({ caseId: CASE, db, session: { role } }));
};
const text = (h) => h.replace(/<[^>]+>/g, " ").replace(/&[a-z#0-9]+;/g, " ").replace(/\s+/g, " ").trim();
const rows = (h) => [...h.matchAll(/<tr data-testid="case-bill"[^>]*>(.*?)<\/tr>/g)].map((m) => m[1]);
const rowByDate = (h, date) => rows(h).find((r) => text(r).startsWith(date));
const testid = (h, id) => { const m = h.match(new RegExp(`data-testid="${id}"[^>]*>([^<]*)<`)); assert.ok(m, `${id} present`); return m[1]; };

test("QA(a) unpaid count is computed from the bills, not tblcase.numunpaidbills (numunpaidbills 5, two open bills → 2)", async () => {
  const html = await render([bill(1001, "1st", "2026-08-01"), bill(1002, "Final", "2026-07-01")], { unpaid: 5 });
  assert.equal(testid(html, "unpaid-bill-count"), "2");
});

test("QA(b) a Paid bill is not counted as unpaid (1st + Paid → 1)", async () => {
  const html = await render([bill(1011, "1st", "2026-07-01"), bill(1012, "Paid", "2026-08-01")], { unpaid: 1 });
  assert.equal(testid(html, "unpaid-bill-count"), "1");
});

test("QA(c) a Deadbeat bill counts as unpaid (Deadbeat alone → 1)", async () => {
  const html = await render([bill(1021, "Deadbeat", "2026-08-01")], { unpaid: 1 });
  assert.equal(testid(html, "unpaid-bill-count"), "1");
});

test("QA(d) bills list newest first by billdate (stored 2026-01-01, 2026-05-01, 2026-03-01)", async () => {
  const html = await render([bill(1031, "Paid", "2026-01-01"), bill(1032, "Paid", "2026-05-01"), bill(1033, "Paid", "2026-03-01")], { unpaid: 0 });
  assert.deepEqual(rows(html).map((r) => text(r).split(" ")[0]), ["2026-05-01", "2026-03-01", "2026-01-01"]);
});

test("QA(e) a legacy bill (billtype null, billhours 0, Paid) is listed with its balance and status", async () => {
  const html = await render([bill(1041, "Paid", "2019-03-04", { billtype: null, billhours: 0, billbalance: 75.5 }), bill(1042, "Paid", "2026-08-01")], { unpaid: 0 });
  const legacy = rowByDate(html, "2019-03-04");
  assert.ok(legacy && /75\.50/.test(text(legacy)) && /Paid/.test(text(legacy)), `legacy row with 75.50 and Paid in: ${text(html)}`);
});

test("QA(f) staff sees no New bill link and no /bills/new href anywhere in the panel", async () => {
  const html = await render([bill(1051, "1st", "2026-08-01")], { unpaid: 1, role: "staff" });
  assert.doesNotMatch(html, /New bill|\/bills\/new/);
});

test("QA(f+) admin sees the New bill link pointing at /bills/new?case=991301", async () => {
  const html = await render([bill(1052, "1st", "2026-08-01")], { unpaid: 1, role: "admin" });
  assert.match(html, /<a [^>]*href="\/bills\/new\?case=991301"[^>]*>New bill<\/a>/);
});

test("QA(g) notice dates come from the latest OPEN bill even when the newest bill overall is Paid with its own dates", async () => {
  const html = await render([
    bill(1061, "Paid", "2026-09-05", { billsecondnoticedate: "2026-09-06", billfinalnoticedate: "2026-09-07" }),
    bill(1062, "Final", "2026-06-01", { billsecondnoticedate: "2026-07-01", billfinalnoticedate: "2026-08-01" }),
  ], { unpaid: 1 });
  assert.deepEqual([testid(html, "second-notice-date"), testid(html, "final-notice-date")], ["2026-07-01", "2026-08-01"]);
});

test("QA(h) unset notice dates on the latest open bill render as empty, not null/undefined/dash", async () => {
  const html = await render([bill(1071, "1st", "2026-08-01")], { unpaid: 1 });
  assert.deepEqual([testid(html, "second-notice-date"), testid(html, "final-notice-date")], ["", ""]);
});

test("QA(i) the full panel markup never contains 'billed' — admin and staff", async () => {
  const fixture = [
    bill(1081, "Deadbeat", "2026-09-01", { billsecondnoticedate: "2026-07-01", billfinalnoticedate: "2026-08-01" }),
    bill(1082, "1st", "2026-08-01"),
    bill(1083, "Paid", "2019-03-04", { billtype: null, billhours: 0 }),
  ];
  for (const role of ["admin", "staff"]) assert.doesNotMatch(await render(fixture, { unpaid: 2, role }), /billed/i, `${role} panel`);
});

test("QA(j) the panel's heading is Bills", async () => {
  const html = await render([bill(1091, "1st", "2026-08-01")], { unpaid: 1 });
  assert.deepEqual([...html.matchAll(/<h\d[^>]*>(.*?)<\/h\d>/g)].map((m) => m[1]), ["Bills"]);
});

test("QA(k) a bill row links to its own bill page /bills/1101", async () => {
  const html = await render([bill(1101, "1st", "2026-08-01")], { unpaid: 1 });
  assert.deepEqual([...rowByDate(html, "2026-08-01").matchAll(/href="([^"]*)"/g)].map((m) => m[1]), ["/bills/1101"]);
});

test("QA(tie) same billdate: the higher billid is the latest open bill for the notice dates", async () => {
  const html = await render([
    bill(1112, "2nd", "2026-08-01", { billsecondnoticedate: "2026-08-20" }),
    bill(1111, "Final", "2026-08-01", { billsecondnoticedate: "2026-08-02", billfinalnoticedate: "2026-08-03" }),
  ].reverse(), { unpaid: 2 });
  assert.equal(testid(html, "second-notice-date"), "2026-08-20");
});
