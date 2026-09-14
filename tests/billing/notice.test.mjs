// Item 4: Advance / Close-as notice actions. Drives runNoticeAction (the real action body) with the real requireSession
// against a stateful fake PostgREST that applies eq/is filters. Every test builds its own world. Literals only.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

process.env.TZ = "UTC"; // server on UTC for the whole file; firmToday must still produce the New York date
globalThis.React = React;
createRequire(import.meta.url)("react-dom").useFormStatus = () => ({ pending: false });
const { runNoticeAction } = await import("../../lib/bills/notice.ts");
const { requireSession } = await import("../../lib/auth/session.ts");
const { BillView } = await import("../../app/bills/[id]/bill-view.tsx");

/** `beforeWrite` runs (awaited) just before an update applies — lets a test interleave a second request. */
function fakeDb(bills, beforeWrite = async () => {}) {
  const tables = { tblbills: bills };
  const updates = [];
  return {
    tables, updates,
    from(table) {
      const q = { filters: [], update: null };
      const b = new Proxy({}, {
        get(_, k) {
          if (k === "then") {
            return (res, rej) => (async () => {
              if (q.update) await beforeWrite();
              const rows = tables[table].filter((r) => q.filters.every((f) => f(r)));
              if (q.update) { updates.push(q.update); for (const r of rows) Object.assign(r, q.update); }
              return { data: rows.map((r) => ({ ...r })), error: null };
            })().then(res, rej);
          }
          return (...a) => {
            if (k === "eq" || k === "is") q.filters.push((r) => r[a[0]] === a[1]);
            if (k === "update") q.update = a[0];
            return b;
          };
        },
      });
      return b;
    },
  };
}

const bill = (o) => ({
  billid: 990701, billcaseid: 990700, billdate: "2026-06-01", billhours: 2, billbalance: 500, billreports: null, billfilename: null,
  billnotice: "1st", billpaiddate: null, billestimate: false, billpriority: null, billcomments: null,
  billsecondnoticedate: null, billfinalnoticedate: null, billtype: "timesheet", supersedesbillid: null, ...o,
});
const sessionClient = (role) => ({
  auth: { getUser: async () => ({ data: { user: { id: "u1", email: "q@example.test" } } }) },
  from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { role, personid: 1 } }) }) }) }),
});
const NOON_NY = new Date("2026-09-12T16:00:00Z");
async function post(kind, db, fields, { role = "admin", now = NOON_NY } = {}) {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.set(k, v);
  let url;
  await assert.rejects(runNoticeAction(kind, 990701, f, {
    session: () => requireSession("admin", sessionClient(role)),
    db: () => db,
    now: () => now,
    revalidatePath: () => {},
    redirect: (u) => { url = u; throw new Error("NEXT_REDIRECT"); },
  }), /NEXT_REDIRECT/);
  return url;
}
const render = (b) => renderToStaticMarkup(React.createElement(BillView, {
  data: { bill: b, casetitle: "Invented v. Fixture", activity: [], revisedBy: [] },
  admin: true, action: async () => {}, advance: async () => {}, close: async () => {},
}));

test("advance twice: 1st → 2nd stamps second date; 2nd → Final stamps final date, second unchanged; Final has no Advance", async () => {
  const db = fakeDb([bill()]);
  assert.equal(await post("advance", db, { expected: "1st" }), "/bills/990701?saved=1");
  assert.deepEqual([db.tables.tblbills[0].billnotice, db.tables.tblbills[0].billsecondnoticedate], ["2nd", "2026-09-12"]);
  const later = new Date("2026-10-15T16:00:00Z");
  assert.equal(await post("advance", db, { expected: "2nd" }, { now: later }), "/bills/990701?saved=1");
  const r = db.tables.tblbills[0];
  assert.deepEqual([r.billnotice, r.billsecondnoticedate, r.billfinalnoticedate, r.billpaiddate], ["Final", "2026-09-12", "2026-10-15", null]);
  assert.match(render(bill({ billnotice: "1st" })), /Advance to 2nd/);
  assert.doesNotMatch(render(r), /Advance to/);
  assert.match(render(r), /Close bill/);
});

test("close as Cancelled on a 2nd bill writes only billnotice", async () => {
  const db = fakeDb([bill({ billnotice: "2nd", billsecondnoticedate: "2026-07-01" })]);
  assert.equal(await post("close", db, { expected: "2nd", target: "Cancelled" }), "/bills/990701?saved=1");
  const r = db.tables.tblbills[0];
  assert.deepEqual([r.billnotice, r.billsecondnoticedate, r.billfinalnoticedate], ["Cancelled", "2026-07-01", null]);
  assert.deepEqual(db.updates, [{ billnotice: "Cancelled" }]);
});

test("Paid bill: both actions refused, row unchanged, no buttons", async () => {
  const paid = bill({ billnotice: "Paid", billpaiddate: "2026-08-01", billsecondnoticedate: "2026-07-01" });
  const snap = JSON.stringify(paid);
  const db = fakeDb([paid]);
  for (const [kind, fields] of [["advance", { expected: "Paid" }], ["advance", { expected: "1st" }], ["close", { expected: "Paid", target: "Cancelled" }], ["close", { expected: "2nd", target: "Settled" }]]) {
    assert.match(await post(kind, db, fields), /\?error=(move|stale)$/, `${kind} ${fields.expected}`);
  }
  assert.equal(JSON.stringify(db.tables.tblbills[0]), snap);
  assert.doesNotMatch(render(paid), /data-testid="bill-notice"/);
});

test("close-as targets outside the set are refused ('Paid', 'Partial Payment'); Deadbeat → Deadbeat refused", async () => {
  for (const [expected, target] of [["1st", "Paid"], ["1st", "Partial Payment"], ["1st", "1st"], ["Deadbeat", "Deadbeat"]]) {
    const db = fakeDb([bill({ billnotice: expected })]);
    assert.equal(await post("close", db, { expected, target }), "/bills/990701?error=move", target);
    assert.equal(db.tables.tblbills[0].billnotice, expected);
    assert.equal(db.updates.length, 0);
  }
  const db = fakeDb([bill({ billnotice: "Final" })]);
  assert.equal(await post("close", db, { expected: "Final", target: "Deadbeat" }), "/bills/990701?saved=1");
  assert.equal(db.tables.tblbills[0].billnotice, "Deadbeat");
});

test("staff: forbidden, no write, no notice controls rendered", async () => {
  const db = fakeDb([bill()]);
  assert.equal(await post("advance", db, { expected: "1st" }, { role: "staff" }), "/bills/990701?error=forbidden");
  assert.equal(await post("close", db, { expected: "1st", target: "Cancelled" }, { role: "staff" }), "/bills/990701?error=forbidden");
  assert.equal(db.updates.length, 0);
  const html = renderToStaticMarkup(React.createElement(BillView, {
    data: { bill: bill(), casetitle: null, activity: [], revisedBy: [] }, admin: false,
  }));
  assert.doesNotMatch(html, /Advance to|Close bill/);
});

test("duplicate submit is stale; an already-stamped second-notice date is never overwritten", async () => {
  const db = fakeDb([bill()]);
  await post("advance", db, { expected: "1st" });
  assert.equal(await post("advance", db, { expected: "1st" }), "/bills/990701?error=stale");
  assert.equal(db.tables.tblbills[0].billnotice, "2nd");

  const stamped = fakeDb([bill({ billsecondnoticedate: "2026-05-05" })]);
  assert.equal(await post("advance", stamped, { expected: "1st" }), "/bills/990701?error=stale");
  assert.deepEqual([stamped.tables.tblbills[0].billnotice, stamped.tables.tblbills[0].billsecondnoticedate], ["1st", "2026-05-05"]);
});

test("concurrent Advance submits on one 1st bill leave it at 2nd, not Final", async () => {
  // Both requests reach the write before either applies; the fake then applies them one at a time.
  let arrived = 0, release;
  const gate = new Promise((r) => (release = r));
  const db = fakeDb([bill()], async () => { if (++arrived === 2) release(); await gate; });
  const urls = await Promise.all([post("advance", db, { expected: "1st" }), post("advance", db, { expected: "1st" })]);
  assert.deepEqual(urls.sort(), ["/bills/990701?error=stale", "/bills/990701?saved=1"]);
  const r = db.tables.tblbills[0];
  assert.deepEqual([r.billnotice, r.billfinalnoticedate], ["2nd", null]);
});

test("23:30 New York with the server on TZ=UTC stamps the New York date", async () => {
  assert.equal(new Date("2026-09-13T03:30:00Z").getDate(), 13); // proves the server clock really is UTC here
  const db = fakeDb([bill()]);
  await post("advance", db, { expected: "1st" }, { now: new Date("2026-09-13T03:30:00Z") }); // 23:30 EDT on Sep 12
  assert.equal(db.tables.tblbills[0].billsecondnoticedate, "2026-09-12");
});
