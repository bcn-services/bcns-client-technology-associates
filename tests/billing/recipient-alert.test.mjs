// Item 7: recipient alert banner + CC line on /bills/new and /bills/[id]. Real views (renderToStaticMarkup), real loaders
// and real action bodies (runCreateBill / runEditBill + real requireSession) over a fake PostgREST that APPLIES
// eq/in/is/insert/update/delete and PROJECTS select columns (so a column dropped from a select is visible). Literals only.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

globalThis.React = React; // tsx compiles .tsx with the classic JSX runtime
createRequire(import.meta.url)("react-dom").useFormStatus = () => ({ pending: false }); // react-dom 18.3 lacks it
const { loadBill, runEditBill } = await import("../../lib/bills/edit.ts");
const { loadNewBill, runCreateBill } = await import("../../lib/bills/create.ts");
const { BillView } = await import("../../app/bills/[id]/bill-view.tsx");
const { NewBillForm } = await import("../../app/bills/new/new-bill-form.tsx");
const { requireSession } = await import("../../lib/auth/session.ts");

const WRITES = ["insert", "update", "upsert", "delete"];
function fakeDb(tables) {
  const calls = [];
  let nextBill = 991050;
  return {
    calls,
    tables,
    from(table) {
      const q = { filters: [], update: null, insert: null, del: false, single: false, cols: null };
      const b = new Proxy({}, {
        get(_, k) {
          if (k === "then") {
            const all = (tables[table] ??= []);
            let rows;
            if (q.insert) {
              const row = { billid: nextBill++, ...q.insert };
              all.push(row);
              rows = [row];
            } else {
              rows = all.filter((r) => q.filters.every((f) => f(r)));
              if (q.update) for (const r of rows) Object.assign(r, q.update);
              if (q.del) tables[table] = all.filter((r) => !rows.includes(r));
            }
            const pick = (r) => (q.cols ? Object.fromEntries(q.cols.map((c) => [c, r[c]])) : { ...r });
            const data = q.single ? (rows[0] ? pick(rows[0]) : null) : rows.map(pick);
            return (res, rej) => Promise.resolve({ data, error: null }).then(res, rej);
          }
          return (...a) => {
            calls.push([table, k, ...a]);
            if (k === "select" && a[0] !== "*") q.cols = String(a[0]).split(",").map((s) => s.trim());
            if (k === "eq") q.filters.push((r) => r[a[0]] === a[1]);
            if (k === "in") q.filters.push((r) => a[1].includes(r[a[0]]));
            if (k === "is") q.filters.push((r) => r[a[0]] === a[1]);
            if (k === "update" || k === "upsert") q.update = a[0];
            if (k === "insert") q.insert = a[0];
            if (k === "delete") q.del = true;
            if (k === "maybeSingle" || k === "single") q.single = true;
            return b;
          };
        },
      });
      return b;
    },
  };
}

const CC = "a@x.test, b@x.test";
const BANNER = "Bill recipient alert — this case bills a different party";
const kase = (caseid, billingalert, billingcc) => ({ caseid, casetitle: `Invented ${caseid} v. Fixture`, caseatty: 77, billingalert, billingcc, numunpaidbills: 0 });
const bill = (billid, billcaseid) => ({
  billid, billcaseid, billdate: "2026-09-01", billhours: 1.5, billbalance: 300, billreports: null, billfilename: null, billnotice: "1st",
  billpaiddate: null, billestimate: false, billpriority: null, billcomments: null, billsecondnoticedate: null, billfinalnoticedate: null,
  billtype: "timesheet", supersedesbillid: null,
});
const act = (actid, acthrs) => ({ actid, actcaseid: 991001, actdate: "2026-09-02", actdescription: `Entry ${actid}`, acthrs, actwho: 1, actbilled: false, actbillid: null });
const world = (cases, bills = [], activity = []) => fakeDb({
  tblcase: cases,
  tblattorney: [{ attyid: 77, attylastname: "Flood" }],
  tblbills: bills,
  tblactivity: activity,
  tblbillingnames: [{ personid: 1, initials: "KJS" }],
});

// Views rendered from literal loader-shaped data, so these tests see only view logic (loaders are covered separately).
const billHtml = (billingalert, billingcc) => renderToStaticMarkup(React.createElement(BillView, {
  data: { bill: bill(991011, 991001), casetitle: "Invented v. Fixture", billingalert, billingcc, activity: [], revisedBy: [] },
  admin: true,
  action: () => {},
}));
const newHtml = (billingalert, billingcc) => renderToStaticMarkup(React.createElement(NewBillForm, {
  data: { caseid: 991001, casetitle: "Invented v. Fixture", billingalert, billingcc, rows: [], today: "2026-09-12" },
  action: () => {},
}));
const bannerCount = (html) => html.split(BANNER).length - 1;
const ccLines = (html) => [...html.matchAll(/>(CC:[^<]*)</g)].map((m) => m[1]);

test("BillView: alert true + cc 'a@x.test, b@x.test' → banner once and CC line with both addresses", () => {
  const html = billHtml(true, CC);
  assert.equal(bannerCount(html), 1);
  assert.deepEqual(ccLines(html), ["CC: a@x.test, b@x.test"]);
});

test("NewBillForm: alert true + cc 'a@x.test, b@x.test' → banner once and CC line with both addresses", () => {
  const html = newHtml(true, CC);
  assert.equal(bannerCount(html), 1);
  assert.deepEqual(ccLines(html), ["CC: a@x.test, b@x.test"]);
});

test("BillView: alert false + non-empty cc → no banner, CC line still shown", () => {
  const html = billHtml(false, CC);
  assert.equal(bannerCount(html), 0);
  assert.deepEqual(ccLines(html), ["CC: a@x.test, b@x.test"]);
});

test("NewBillForm: alert false + non-empty cc → no banner, CC line still shown", () => {
  const html = newHtml(false, CC);
  assert.equal(bannerCount(html), 0);
  assert.deepEqual(ccLines(html), ["CC: a@x.test, b@x.test"]);
});

test("empty cc (null / '' / whitespace) → no CC line on either view; banner follows the alert alone", () => {
  // [alert, cc, expected banner count]: alert=true with whitespace cc means a "show CC when alert" bug cannot hide.
  for (const [alert, cc, banners] of [[false, null, 0], [false, "", 0], [false, "   ", 0], [true, " \t ", 1], [true, null, 1]]) {
    for (const [view, html] of [["BillView", billHtml(alert, cc)], ["NewBillForm", newHtml(alert, cc)]]) {
      const label = `${view} alert=${alert} cc=${JSON.stringify(cc)}`;
      assert.deepEqual(ccLines(html), [], label);
      assert.doesNotMatch(html, /CC:/, label);
      assert.equal(bannerCount(html), banners, label);
    }
  }
});

test("loadBill passes tblcase billingalert/billingcc through (true + cc, false + null) with one tblcase read per load", async () => {
  const db = world([kase(991001, true, CC), kase(991002, false, null)], [bill(991011, 991001), bill(991012, 991002)]);
  const a = await loadBill(db, 991011);
  assert.equal(a.billingalert, true);
  assert.equal(a.billingcc, "a@x.test, b@x.test");
  const b = await loadBill(db, 991012);
  assert.equal(b.billingalert, false);
  assert.equal(b.billingcc, null);
  assert.equal(db.calls.filter((c) => c[0] === "tblcase" && c[1] === "select").length, 2);
});

test("loadNewBill passes tblcase billingalert/billingcc through (true + cc, false + null) with one tblcase read per load", async () => {
  const db = world([kase(991001, true, CC), kase(991002, false, null)]);
  const now = new Date("2026-09-12T15:00:00Z");
  const a = await loadNewBill(db, 991001, now);
  assert.equal(a.billingalert, true);
  assert.equal(a.billingcc, "a@x.test, b@x.test");
  const b = await loadNewBill(db, 991002, now);
  assert.equal(b.billingalert, false);
  assert.equal(b.billingcc, null);
  assert.equal(db.calls.filter((c) => c[0] === "tblcase" && c[1] === "select").length, 2);
});

const sessionClient = (role) => ({
  auth: { getUser: async () => ({ data: { user: { id: "u1", email: "x@example.test" } } }) },
  from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { role, personid: 1 } }) }) }) }),
});
const deps = (db, redirects) => ({
  session: () => requireSession("admin", sessionClient("admin")),
  db: () => db,
  revalidatePath: () => {},
  redirect: (u) => { redirects.push(u); throw Object.assign(new Error("NEXT_REDIRECT"), { url: u }); },
});
const form = (o, actids = []) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(o)) f.set(k, v);
  for (const id of actids) f.append("actid", String(id));
  return f;
};
const CREATE = { caseid: "991001", billtype: "timesheet", billdate: "2026-09-12", billbalance: "450.00", billnotice: "1st", billcomments: "" };
const EDIT = { billdate: "2026-09-02", billtype: "depo", billbalance: "500.00", billcomments: "Edited", billfilename: "" };
const alertWorld = () => world([kase(991001, true, CC)], [bill(991011, 991001)], [act(21, "1.500")]);

test("display-only: runCreateBill on an alert + cc case redirects to the new bill and inserts exactly the typed bill", async () => {
  const db = alertWorld();
  const redirects = [];
  await assert.rejects(runCreateBill(form(CREATE, [21]), deps(db, redirects)), /NEXT_REDIRECT/);
  assert.deepEqual(redirects, ["/bills/991050"]);
  assert.deepEqual(db.tables.tblbills.find((b) => b.billid === 991050), {
    billid: 991050, billcaseid: 991001, billdate: "2026-09-12", billhours: "1.500", billbalance: "450.00", billnotice: "1st",
    billestimate: false, billcomments: null, billtype: "timesheet", billfilename: "Bill991001 Flood 2026 09 12-0",
  });
});

test("display-only: runEditBill on an alert + cc case saves the edited columns unchanged", async () => {
  const db = alertWorld();
  const redirects = [];
  await assert.rejects(runEditBill(991011, form(EDIT), deps(db, redirects)), /NEXT_REDIRECT/);
  assert.deepEqual(redirects, ["/bills/991011?saved=1"]);
  assert.deepEqual(db.tables.tblbills[0], {
    ...bill(991011, 991001), billdate: "2026-09-02", billtype: "depo", billbalance: "500.00", billcomments: "Edited", billfilename: null, billestimate: false,
  });
});

test("display-only: create + edit on an alert + cc case record zero insert/update/upsert/delete calls against tblcase", async () => {
  const db = alertWorld();
  const redirects = [];
  await assert.rejects(runCreateBill(form(CREATE, [21]), deps(db, redirects)), /NEXT_REDIRECT/);
  await assert.rejects(runEditBill(991011, form(EDIT), deps(db, redirects)), /NEXT_REDIRECT/);
  assert.deepEqual(redirects, ["/bills/991050", "/bills/991011?saved=1"]);
  assert.deepEqual(db.calls.filter((c) => c[0] === "tblcase" && WRITES.includes(c[1])), []);
  assert.deepEqual(db.tables.tblcase, [kase(991001, true, CC)]);
});
