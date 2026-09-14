// Item 5: runRevise with the real requireSession against a stateful fake PostgREST (eq/in/is/insert/update/delete).
// `hook(table, q, tables)` runs just before each statement executes, so a test can play a concurrent writer. Literals only.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

globalThis.React = React;
createRequire(import.meta.url)("react-dom").useFormStatus = () => ({ pending: false });
const { runRevise } = await import("../../lib/bills/revise.ts");
const { requireSession } = await import("../../lib/auth/session.ts");
const { unbilledHours, listCaseTime } = await import("../../lib/time/case.ts");
const { BillView } = await import("../../app/bills/[id]/bill-view.tsx");

function fakeDb(tables, hook = () => {}) {
  const calls = [];
  let nextBill = 880000;
  return {
    calls, tables,
    from(table) {
      const q = { filters: [], update: null, insert: null, del: false, single: false };
      const b = new Proxy({}, {
        get(_, k) {
          if (k === "then") {
            hook(table, q, tables);
            const all = (tables[table] ??= []);
            let rows;
            if (q.insert) { const row = { billid: nextBill++, ...q.insert }; all.push(row); rows = [row]; }
            else {
              rows = all.filter((r) => q.filters.every((f) => f(r)));
              if (q.update) for (const r of rows) Object.assign(r, q.update);
              if (q.del) tables[table] = all.filter((r) => !rows.includes(r));
            }
            const data = q.single ? rows[0] ?? null : rows.map((r) => ({ ...r }));
            return (res, rej) => Promise.resolve({ data, error: null }).then(res, rej);
          }
          return (...a) => {
            calls.push([table, k, ...a]);
            if (k === "eq" || k === "is") q.filters.push((r) => r[a[0]] === a[1]);
            if (k === "in") q.filters.push((r) => a[1].includes(r[a[0]]));
            if (k === "update") q.update = a[0];
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

const CASE = 991200;
const B = 700;
const bill = (o = {}) => ({
  billid: B, billcaseid: CASE, billdate: "2026-06-01", billhours: 3.5, billbalance: 875, billreports: 2, billfilename: "Bill991200 Marlowe 2026 06 01-0",
  billnotice: "1st", billpaiddate: null, billestimate: true, billpriority: 1, billcomments: "orig note",
  billsecondnoticedate: null, billfinalnoticedate: null, billtype: "depo", supersedesbillid: null, ...o,
});
const act = (actid, acthrs, o = {}) => ({ actid, actcaseid: CASE, actdate: "2026-05-20", actdescription: `T ${actid}`, acthrs, actwho: 1, actbilled: true, actbillid: B, ...o });
const world = (bills, activity, hook) => fakeDb({
  tblcase: [{ caseid: CASE, casetitle: "Invented v. Fixture", caseatty: 31 }],
  tblattorney: [{ attyid: 31, attylastname: "Marlowe" }],
  tblbills: bills,
  tblactivity: activity,
  tblbillingnames: [{ personid: 1, initials: "QA" }],
}, hook);
const standard = (hook, bills = [bill()]) => world(bills, [
  act(11, "1.500"), act(12, "2.000"),
  act(13, "4.000", { actbillid: 701 }), // another bill's row — must never move
  act(14, "0.250", { actbilled: false, actbillid: null }), // unbilled
], hook);
const sessionClient = (role) => ({
  auth: { getUser: async () => ({ data: { user: { id: "u1", email: "q@example.test" } } }) },
  from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { role, personid: 1 } }) }) }) }),
});
const NOON_NY = new Date("2026-09-12T16:00:00Z");
async function post(db, expected = "1st", role = "admin", id = B) {
  const f = new FormData();
  f.set("expected", expected);
  const urls = [];
  await assert.rejects(runRevise(id, f, {
    session: () => requireSession("admin", sessionClient(role)),
    db: () => db,
    now: () => NOON_NY,
    revalidatePath: () => {},
    redirect: (u) => { urls.push(u); throw new Error("NEXT_REDIRECT"); },
  }), /NEXT_REDIRECT/);
  return urls[0];
}
const newBills = (db) => db.tables.tblbills.filter((b) => b.billid >= 880000);
const row = (db, id) => db.tables.tblactivity.find((r) => r.actid === id);
const getB = (db) => db.tables.tblbills.find((b) => b.billid === B);

test("revise open B with two rows → B′ copies type/hours/balance/estimate/comments, '1st', today, new file name; rows moved; B only Cancelled", async () => {
  const db = standard();
  const before = { ...getB(db) };
  const unbilledBefore = unbilledHours(await listCaseTime(db, CASE));
  assert.equal(await post(db), "/bills/880000");
  const [n] = newBills(db);
  assert.equal(newBills(db).length, 1);
  assert.deepEqual(
    { ...n },
    { billid: 880000, billcaseid: CASE, billtype: "depo", billhours: 3.5, billbalance: 875, billestimate: true, billcomments: "orig note",
      billdate: "2026-09-12", billnotice: "1st", billfilename: "Bill991200 Marlowe 2026 09 12-0", supersedesbillid: B },
  );
  assert.equal(row(db, 11).actbillid, 880000);
  assert.equal(row(db, 12).actbillid, 880000);
  assert.equal(row(db, 11).actbilled, true);
  assert.equal(row(db, 13).actbillid, 701, "another bill's row untouched");
  assert.deepEqual(getB(db), { ...before, billnotice: "Cancelled" });
  assert.equal(unbilledHours(await listCaseTime(db, CASE)), unbilledBefore);
  assert.equal(unbilledBefore, "0.250");
  const moveUpd = db.calls.filter((c) => c[0] === "tblactivity" && c[1] === "update");
  assert.deepEqual(moveUpd.map((c) => c[2]), [{ actbillid: 880000 }], "row move writes only actbillid");
});

test("revising B a second time is refused and inserts no bill", async () => {
  const db = standard();
  await post(db);
  assert.equal(await post(db, "Cancelled"), `/bills/${B}?error=move`);
  assert.equal(newBills(db).length, 1);
});

test("open B already superseded by another bill → ?error=revised, nothing inserted, B unchanged", async () => {
  const db = standard(undefined, [bill(), bill({ billid: 702, supersedesbillid: B, billnotice: "Cancelled" })]);
  assert.equal(await post(db), `/bills/${B}?error=revised`);
  assert.equal(newBills(db).length, 0);
  assert.equal(getB(db).billnotice, "1st");
  assert.equal(row(db, 11).actbillid, B);
});

test("closed B (Paid) → ?error=move, nothing inserted", async () => {
  const db = standard(undefined, [bill({ billnotice: "Paid" })]);
  assert.equal(await post(db, "Paid"), `/bills/${B}?error=move`);
  assert.equal(newBills(db).length, 0);
});

test("page rendered a different notice than B has now → ?error=stale, nothing inserted", async () => {
  const db = standard(undefined, [bill({ billnotice: "2nd" })]);
  assert.equal(await post(db, "1st"), `/bills/${B}?error=stale`);
  assert.equal(newBills(db).length, 0);
  assert.equal(getB(db).billnotice, "2nd");
});

test("staff → ?error=forbidden with no DB call", async () => {
  const db = standard();
  assert.equal(await post(db, "1st", "staff"), `/bills/${B}?error=forbidden`);
  assert.equal(db.calls.length, 0);
});

test("compensation: a row attached to B between read and move → stale, rows back on B, B′ deleted, B still '1st'", async () => {
  const db = standard((table, q, t) => {
    if (table === "tblactivity" && q.update?.actbillid === 880000) t.tblactivity.push(act(15, "1.000"));
  });
  assert.equal(await post(db), `/bills/${B}?error=stale`);
  assert.equal(newBills(db).length, 0);
  for (const id of [11, 12, 15]) assert.equal(row(db, id).actbillid, B, `row ${id} back on B`);
  assert.equal(row(db, 13).actbillid, 701);
  assert.equal(getB(db).billnotice, "1st");
});

test("compensation: B's notice changes before the cancel → stale, rows back on B, B′ deleted, other writer's notice kept", async () => {
  const db = standard((table, q, t) => {
    if (table === "tblbills" && q.update?.billnotice === "Cancelled") t.tblbills.find((b) => b.billid === B).billnotice = "2nd";
  });
  assert.equal(await post(db), `/bills/${B}?error=stale`);
  assert.equal(newBills(db).length, 0);
  assert.equal(row(db, 11).actbillid, B);
  assert.equal(row(db, 12).actbillid, B);
  assert.equal(getB(db).billnotice, "2nd");
});

test("two concurrent revises of B (with rows) → exactly one B′, rows on it, no orphan", async () => {
  const db = standard();
  const urls = await Promise.all([post(db), post(db)]);
  const kept = newBills(db);
  assert.equal(kept.length, 1);
  assert.ok(urls.includes(`/bills/${kept[0].billid}`) && urls.includes(`/bills/${B}?error=stale`), urls.join(" "));
  assert.equal(row(db, 11).actbillid, kept[0].billid);
  assert.equal(row(db, 12).actbillid, kept[0].billid);
  assert.equal(getB(db).billnotice, "Cancelled");
});

test("two concurrent revises of B with no rows → exactly one B′ (cancel guard decides)", async () => {
  const db = world([bill()], []);
  await Promise.all([post(db), post(db)]);
  assert.equal(newBills(db).length, 1);
  assert.equal(getB(db).billnotice, "Cancelled");
});

const render = (b, { admin = true, revisedBy = [], revise = async () => {} } = {}) => renderToStaticMarkup(React.createElement(BillView, {
  data: { bill: b, casetitle: "Invented v. Fixture", activity: [], revisedBy },
  admin, revise: admin ? revise : undefined,
}));
const hasRevise = (html) => />Revise<\/button>/.test(html);

test("Revise button: only for admin + open + not superseded", () => {
  assert.equal(hasRevise(render(bill())), true);
  assert.equal(hasRevise(render(bill(), { admin: false })), false);
  assert.equal(hasRevise(render(bill({ billnotice: "Cancelled" }))), false);
  assert.equal(hasRevise(render(bill(), { revisedBy: [880000] })), false);
});

test("links: B shows 'Revised by #B′' → /bills/B′; B′ shows 'Revises #B' → /bills/B", () => {
  assert.match(render(bill({ billnotice: "Cancelled" }), { revisedBy: [880000] }), /<a [^>]*href="\/bills\/880000"[^>]*>Revised by #880000<\/a>/);
  assert.match(render(bill({ billid: 880000, supersedesbillid: B })), /<a [^>]*href="\/bills\/700"[^>]*>Revises #700<\/a>/);
});
