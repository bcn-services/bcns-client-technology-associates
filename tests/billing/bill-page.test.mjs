// Unit tests for lib/bills/edit.ts + app/bills/[id]/bill-view.tsx + the editBill action body (fake PostgREST, pattern:
// tests/cases/create.test.mjs). The fake APPLIES eq/order/update to its rows. Expected values are literals.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

globalThis.React = React; // tsx compiles .tsx with the classic JSX runtime
createRequire(import.meta.url)("react-dom").useFormStatus = () => ({ pending: false }); // react-dom 18.3 lacks it; Next ships canary
const { loadBill, runEditBill, updateBill } = await import("../../lib/bills/edit.ts");
const { BillView } = await import("../../app/bills/[id]/bill-view.tsx");
const { requireSession } = await import("../../lib/auth/session.ts");

function fakeDb(tables) {
  const calls = [];
  return {
    calls,
    tables,
    from(table) {
      const q = { filters: [], orders: [], update: null, single: false };
      const b = new Proxy({}, {
        get(_, k) {
          if (k === "then") {
            let rows = (tables[table] ?? []).filter((r) => q.filters.every((f) => f(r)));
            if (q.update) for (const r of rows) Object.assign(r, q.update);
            for (const [col, asc] of [...q.orders].reverse()) rows = [...rows].sort((x, y) => (x[col] < y[col] ? -1 : x[col] > y[col] ? 1 : 0) * (asc ? 1 : -1));
            const data = q.single ? rows[0] ?? null : rows.map((r) => ({ ...r }));
            return (res, rej) => Promise.resolve({ data, error: null }).then(res, rej);
          }
          return (...a) => {
            calls.push([table, k, ...a]);
            if (k === "eq") q.filters.push((r) => r[a[0]] === a[1]);
            if (k === "order") q.orders.push([a[0], a[1]?.ascending !== false]);
            if (k === "update") q.update = a[0];
            if (k === "maybeSingle") q.single = true;
            return b;
          };
        },
      });
      return b;
    },
  };
}

const bill = (o) => ({
  billid: 990501, billcaseid: 990500, billdate: "2026-08-14", billhours: 3.5, billbalance: 875, billreports: null, billfilename: null,
  billnotice: "1st", billpaiddate: null, billestimate: false, billpriority: null, billcomments: "orig", billsecondnoticedate: null,
  billfinalnoticedate: null, billtype: "timesheet", supersedesbillid: null, ...o,
});
const act = (actid, acthrs, actwho, actdescription, actbillid = 990501) =>
  ({ actid, actcaseid: 990500, actdate: `2026-08-0${actid % 9 + 1}`, actdescription, acthrs, actwho, actbilled: true, actbillid });
const world = (bills, activity = []) => fakeDb({
  tblbills: bills,
  tblcase: [{ caseid: 990500, casetitle: "Invented v. Fixture" }],
  tblactivity: activity,
  tblbillingnames: [{ personid: 1, initials: "KJS" }, { personid: 2, initials: "JON" }],
});
const text = (html) => html.replace(/<[^>]+>/g, " ").replace(/&[a-z#0-9]+;/g, " ").replace(/\s+/g, " ").trim();
const field = (html, name) => text(html.match(new RegExp(`<dd data-field="${name}">(.*?)</dd>`))?.[1] ?? "MISSING");
const render = (data, admin) => renderToStaticMarkup(React.createElement(BillView, { data, admin, action: () => {} }));

test("legacy bill (type null, hours 0, Paid) renders balance, status and an em-dash for type", async () => {
  const db = world([bill({ billid: 7, billtype: null, billhours: 0, billnotice: "Paid", billbalance: "120.5", billpaiddate: "2019-02-01" })]);
  const html = render(await loadBill(db, 7), false);
  assert.equal(field(html, "Type"), "—");
  assert.equal(field(html, "Balance"), "120.50");
  assert.equal(field(html, "Status"), "Paid");
  assert.equal(field(html, "Hours"), "0.00");
  assert.match(html, /href="\/cases\/990500"/);
});

test("two attached activity rows are listed with their hours; an unattached row is not", async () => {
  const db = world([bill()], [act(1, "2.000", 1, "Site inspection"), act(2, "1.500", 2, "Photo review"), act(3, "9.000", 1, "Other bill", 42)]);
  const rows = [...render(await loadBill(db, 990501), false).matchAll(/<tr data-testid="bill-activity">(.*?)<\/tr>/g)].map((m) => text(m[1]));
  assert.deepEqual(rows, ["2026-08-02 KJS Site inspection 2.000", "2026-08-03 JON Photo review 1.500"]);
});

test("revision links: Revises #M and Revised by #K", async () => {
  const db = world([bill({ billid: 10 }), bill({ billid: 11, supersedesbillid: 10 }), bill({ billid: 12, supersedesbillid: 11 })]);
  const html = render(await loadBill(db, 11), false);
  assert.match(html, /<a [^>]*href="\/bills\/10">Revises #10<\/a>/);
  assert.match(html, /<a [^>]*href="\/bills\/12">Revised by #12<\/a>/);
});

test("unknown id → loadBill null (page calls notFound)", async () => {
  assert.equal(await loadBill(world([bill()]), 5), null);
  assert.match(readFileSync(new URL("../../app/bills/[id]/page.tsx", import.meta.url), "utf8"), /if \(!data\) notFound\(\)/);
});

test("staff render has no edit form; admin render has one", async () => {
  const data = await loadBill(world([bill()]), 990501);
  assert.doesNotMatch(render(data, false), /<form/);
  assert.match(render(data, true), /<form[^>]*data-testid="bill-edit"/);
});

// Session client fake for the REAL requireSession: role comes from `profiles`.
const sessionClient = (role) => ({
  auth: { getUser: async () => ({ data: { user: { id: "u1", email: "x@example.test" } } }) },
  from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { role, personid: 1 } }) }) }) }),
});
function deps(db, role) {
  const out = { redirects: [], revalidated: [] };
  out.deps = {
    session: () => requireSession("admin", sessionClient(role)),
    db: () => db,
    revalidatePath: (p) => out.revalidated.push(p),
    redirect: (u) => { out.redirects.push(u); throw Object.assign(new Error("NEXT_REDIRECT"), { url: u }); },
  };
  return out;
}
const form = (o) => { const f = new FormData(); for (const [k, v] of Object.entries(o)) f.set(k, v); return f; };
const EDIT = { billdate: "2026-08-14", billtype: "timesheet", billbalance: "900.00", billcomments: "Client called", billfilename: "" };

test("admin edit 875.00 → 900.00 + comments; reload shows both; notice/hours unchanged; forged forbidden fields not written", async () => {
  const db = world([bill()]);
  const d = deps(db, "admin");
  const forged = { ...EDIT, billnotice: "Final", billhours: "99", billcaseid: "1", billpaiddate: "2026-01-01", billsecondnoticedate: "2026-01-01", billfinalnoticedate: "2026-01-01" };
  await assert.rejects(runEditBill(990501, form(forged), d.deps), /NEXT_REDIRECT/);
  assert.deepEqual(d.redirects, ["/bills/990501?saved=1"]);
  const upd = db.calls.filter((c) => c[1] === "update");
  assert.equal(upd.length, 1);
  assert.deepEqual(Object.keys(upd[0][2]).sort(), ["billbalance", "billcomments", "billdate", "billestimate", "billfilename", "billtype"]);
  assert.equal(db.calls.some((c) => c[0] === "tblactivity"), false);
  const row = db.tables.tblbills[0];
  assert.equal(row.billnotice, "1st");
  assert.equal(row.billhours, 3.5);
  assert.equal(row.billcaseid, 990500);
  assert.equal(row.billpaiddate, null);
  const html = render(await loadBill(db, 990501), true);
  assert.equal(field(html, "Balance"), "900.00");
  assert.equal(field(html, "Comments"), "Client called");
  assert.match(html, /name="billbalance"[^>]*value="900.00"/);
});

test("negative balance allowed; bad balance refused with no write", async () => {
  const db = world([bill()]);
  const d = deps(db, "admin");
  await assert.rejects(runEditBill(990501, form({ ...EDIT, billbalance: "-25.10" }), d.deps));
  assert.equal(db.tables.tblbills[0].billbalance, "-25.10");
  const db2 = world([bill()]);
  const d2 = deps(db2, "admin");
  await assert.rejects(runEditBill(990501, form({ ...EDIT, billbalance: "12.345" }), d2.deps));
  assert.deepEqual(d2.redirects, ["/bills/990501?error=balance"]);
  assert.equal(db2.calls.some((c) => c[1] === "update"), false);
});

test("staff POST through the real action body + real requireSession is refused; no DB call, row unchanged", async () => {
  const db = world([bill()]);
  const d = deps(db, "staff");
  await assert.rejects(runEditBill(990501, form(EDIT), d.deps), /NEXT_REDIRECT/);
  assert.deepEqual(d.redirects, ["/bills/990501?error=forbidden"]);
  assert.deepEqual(db.calls, []);
  assert.equal(db.tables.tblbills[0].billbalance, 875);
  assert.equal(db.tables.tblbills[0].billcomments, "orig");
});

test("updateBill: a missing bill (0 rows updated) is refused as notfound", async () => {
  await assert.rejects(updateBill(world([]), 5, { billdate: "2026-08-14", billtype: null, billbalance: "1", billestimate: false, billcomments: null, billfilename: null }), (e) => e.code === "notfound");
});

test("the server action wires requireSession('admin') into runEditBill", () => {
  const src = readFileSync(new URL("../../app/bills/actions.ts", import.meta.url), "utf8");
  assert.match(src, /session: \(\) => requireSession\("admin"\)/);
  assert.match(src, /runEditBill\(billid, formData,/);
});
