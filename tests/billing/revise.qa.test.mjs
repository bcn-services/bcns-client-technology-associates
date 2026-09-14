// QA (item 5): drives the real runRevise (lib/bills/revise.ts) with the real requireSession against a stateful fake
// PostgREST. `hook(table, q, tables)` fires just before a statement executes, so a test can play a concurrent writer.
// Assertions use written-out literals only.
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
  let next = 50000;
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
            if (q.insert) { const r = { billid: next++, ...q.insert }; all.push(r); rows = [r]; }
            else {
              rows = all.filter((r) => q.filters.every((f) => f(r)));
              if (q.update) for (const r of rows) Object.assign(r, q.update);
              if (q.del) tables[table] = all.filter((r) => !rows.includes(r));
            }
            const data = q.single ? (rows[0] ? { ...rows[0] } : null) : rows.map((r) => ({ ...r }));
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

const CASE = 990950;
const BID = 400;
const OTHER = 401;
const billB = (o = {}) => ({
  billid: 400, billcaseid: 990950, billdate: "2026-05-04", billhours: 2.75, billbalance: 510.25, billreports: 3,
  billfilename: "Bill990950 Qa 2026 05 04-0", billnotice: "2nd", billpaiddate: null, billestimate: false, billpriority: 2,
  billcomments: "qa comment", billsecondnoticedate: "2026-06-01", billfinalnoticedate: null, billtype: "mediation",
  supersedesbillid: null, ...o,
});
const otherBill = () => billB({ billid: 401, billnotice: "1st", billsecondnoticedate: null, billfilename: "other" });
const act = (actid, acthrs, o = {}) => ({ actid, actcaseid: 990950, actdate: "2026-04-10", actdescription: `qa ${actid}`, acthrs, actwho: 1, actbilled: true, actbillid: 400, ...o });
const mk = ({ bills = [billB(), otherBill()], hook } = {}) => fakeDb({
  tblcase: [{ caseid: 990950, casetitle: "QA v. Revise", caseatty: 7 }],
  tblattorney: [{ attyid: 7, attylastname: "Qa" }],
  tblbills: bills,
  tblactivity: [
    act(21, "1.250"), act(22, "1.500"),
    act(23, "3.000", { actbillid: 401 }),
    act(24, "0.750", { actbilled: false, actbillid: null }),
  ],
  tblbillingnames: [{ personid: 1, initials: "QA" }],
}, hook);
const sessionClient = (role) => ({
  auth: { getUser: async () => ({ data: { user: { id: "u-qa", email: "qa@example.test" } } }) },
  from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { role, personid: 1 } }) }) }) }),
});
async function revise(db, { expected = "2nd", role = "admin", id = 400 } = {}) {
  const f = new FormData();
  f.set("expected", expected);
  const urls = [];
  await assert.rejects(runRevise(id, f, {
    session: () => requireSession("admin", sessionClient(role)),
    db: () => db,
    now: () => new Date("2026-09-12T15:00:00Z"),
    revalidatePath: () => {},
    redirect: (u) => { urls.push(u); throw new Error("NEXT_REDIRECT"); },
  }), /NEXT_REDIRECT/);
  return urls[0];
}
const B = (db) => db.tables.tblbills.find((b) => b.billid === 400);
const act$ = (db, id) => db.tables.tblactivity.find((r) => r.actid === id);
const billCount = (db) => db.tables.tblbills.length;
const flipOnCancel = (table, q, t) => {
  if (table === "tblbills" && q.update?.billnotice === "Cancelled") t.tblbills.find((b) => b.billid === 400).billnotice = "Final";
};

test("qa: revise B with two rows → B′ has B's type/hours/balance and '1st', rows on B′, B Cancelled with every other column unchanged", async () => {
  const db = mk();
  const before = structuredClone(B(db));
  assert.equal(await revise(db), "/bills/50000");
  const n = db.tables.tblbills.find((b) => b.billid === 50000);
  assert.equal(billCount(db), 3);
  assert.deepEqual(
    [n.billcaseid, n.billtype, n.billhours, n.billbalance, n.billestimate, n.billcomments, n.billnotice, n.billdate, n.supersedesbillid],
    [990950, "mediation", 2.75, 510.25, false, "qa comment", "1st", "2026-09-12", 400],
  );
  assert.equal(n.billfilename, "Bill990950 Qa 2026 09 12-0");
  assert.equal(act$(db, 21).actbillid, 50000);
  assert.equal(act$(db, 22).actbillid, 50000);
  assert.deepEqual(B(db), { ...before, billnotice: "Cancelled" });
});

test("qa: B is never deleted and the only column written to B is billnotice", async () => {
  const db = mk();
  await revise(db);
  const toB = db.calls.filter((c) => c[0] === "tblbills" && (c[1] === "update" || c[1] === "delete"));
  assert.deepEqual(toB.filter((c) => c[1] === "delete"), []);
  assert.deepEqual(toB.map((c) => c[2]), [{ billnotice: "Cancelled" }]);
});

test("qa: case unbilled hours equal before and after the revise", async () => {
  const db = mk();
  const before = unbilledHours(await listCaseTime(db, 990950));
  await revise(db);
  assert.equal(unbilledHours(await listCaseTime(db, 990950)), before);
  assert.equal(before, "0.750");
});

test("qa: another bill's rows on the same case are untouched by a revise", async () => {
  const db = mk();
  await revise(db);
  assert.deepEqual(act$(db, 23), act(23, "3.000", { actbillid: 401 }));
  assert.deepEqual(act$(db, 24), act(24, "0.750", { actbilled: false, actbillid: null }));
  assert.equal(db.tables.tblbills.find((b) => b.billid === 401).billnotice, "1st");
});

test("qa: revising B a second time is refused and inserts no bill", async () => {
  const db = mk();
  await revise(db);
  assert.equal(billCount(db), 3);
  assert.match(await revise(db), /^\/bills\/400\?error=/);
  assert.match(await revise(db, { expected: "Cancelled" }), /^\/bills\/400\?error=/);
  assert.equal(billCount(db), 3);
  assert.equal(act$(db, 21).actbillid, 50000);
});

test("qa: staff session refused (forbidden), nothing inserted", async () => {
  const db = mk();
  assert.equal(await revise(db, { role: "staff" }), "/bills/400?error=forbidden");
  assert.equal(billCount(db), 2);
  assert.equal(B(db).billnotice, "2nd");
  assert.equal(act$(db, 21).actbillid, 400);
});

test("qa: already-superseded OPEN B refused with ?error=revised, no insert", async () => {
  const db = mk({ bills: [billB(), otherBill(), billB({ billid: 402, supersedesbillid: 400, billnotice: "Cancelled" })] });
  assert.equal(await revise(db), "/bills/400?error=revised");
  assert.equal(billCount(db), 3);
  assert.equal(B(db).billnotice, "2nd");
  assert.equal(act$(db, 21).actbillid, 400);
});

test("qa: closed B (Settled) refused, no insert", async () => {
  const db = mk({ bills: [billB({ billnotice: "Settled" }), otherBill()] });
  assert.equal(await revise(db, { expected: "Settled" }), "/bills/400?error=move");
  assert.equal(billCount(db), 2);
});

test("qa: stale status flip before cancel → ?error=stale", async () => {
  const db = mk({ hook: flipOnCancel });
  assert.equal(await revise(db), "/bills/400?error=stale");
  assert.equal(B(db).billnotice, "Final", "other writer's notice kept");
});

test("qa: stale status flip before cancel → rows rolled back onto B", async () => {
  const db = mk({ hook: flipOnCancel });
  await revise(db);
  assert.deepEqual([act$(db, 21).actbillid, act$(db, 22).actbillid, act$(db, 23).actbillid], [400, 400, 401]);
});

test("qa: stale status flip before cancel → no orphan B′", async () => {
  const db = mk({ hook: flipOnCancel });
  await revise(db);
  assert.deepEqual(db.tables.tblbills.map((b) => b.billid).sort(), [400, 401]);
});

test("qa: two concurrent revises of the same B → exactly one B′, rows on it, no orphan", async () => {
  const db = mk();
  const urls = await Promise.all([revise(db), revise(db)]);
  const fresh = db.tables.tblbills.filter((b) => b.billid >= 50000);
  assert.equal(fresh.length, 1, JSON.stringify(urls));
  assert.deepEqual(urls.slice().sort(), [`/bills/${fresh[0].billid}`, "/bills/400?error=stale"].sort());
  assert.equal(act$(db, 21).actbillid, fresh[0].billid);
  assert.equal(act$(db, 22).actbillid, fresh[0].billid);
  assert.equal(B(db).billnotice, "Cancelled");
});

const view = (bill, { admin = true, revisedBy = [] } = {}) => renderToStaticMarkup(React.createElement(BillView, {
  data: { bill, casetitle: "QA v. Revise", activity: [], revisedBy },
  admin, revise: admin ? async () => {} : undefined,
}));
const reviseButtons = (html) => (html.match(/<button[^>]*>\s*Revise\s*<\/button>/g) ?? []).length;

test("qa render: Revise button present for admin on open unsuperseded bill", () => {
  assert.equal(reviseButtons(view(billB())), 1);
});
test("qa render: no Revise button on a superseded bill", () => {
  assert.equal(reviseButtons(view(billB(), { revisedBy: [50000] })), 0);
});
test("qa render: no Revise button on a closed bill", () => {
  assert.equal(reviseButtons(view(billB({ billnotice: "Paid" }))), 0);
});
test("qa render: no Revise button for staff", () => {
  assert.equal(reviseButtons(view(billB(), { admin: false })), 0);
});
test("qa render: 'Revised by #B′' links to /bills/B′ and 'Revises #B' links to /bills/B", () => {
  assert.match(view(billB({ billnotice: "Cancelled" }), { revisedBy: [50000] }), /<a[^>]*href="\/bills\/50000"[^>]*>Revised by #(<!-- -->)?50000<\/a>/);
  assert.match(view(billB({ billid: 50000, supersedesbillid: 400 })), /<a[^>]*href="\/bills\/400"[^>]*>Revises #(<!-- -->)?400<\/a>/);
});
