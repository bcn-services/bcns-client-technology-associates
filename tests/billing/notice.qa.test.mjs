// QA (item 4): Advance / Close-as through runNoticeAction (the real action body) with the real requireSession, against
// an independent stateful fake PostgREST that applies eq/is filters and throws on any method it doesn't model.
// Every test builds its own world. Expectations are written-out literals, never the module's constants.
process.env.TZ = "UTC"; // before any Date use: the server runs on UTC, the firm is in New York
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

globalThis.React = React;
createRequire(import.meta.url)("react-dom").useFormStatus = () => ({ pending: false });
const { runNoticeAction } = await import("../../lib/bills/notice.ts");
const { requireSession } = await import("../../lib/auth/session.ts");
const { BillView } = await import("../../app/bills/[id]/bill-view.tsx");

const ID = 990811;
/** `beforeWrite` is awaited before an update statement filters + applies, so a test can interleave two requests. */
function fakeDb(rows, beforeWrite = async () => {}) {
  const log = { from: 0, writes: [] };
  return {
    rows, log,
    from(table) {
      log.from++;
      assert.equal(table, "tblbills");
      const q = { filters: [], update: null };
      const b = new Proxy({}, {
        get(_, k) {
          if (k === "then") {
            return (res, rej) => (async () => {
              if (q.update) await beforeWrite();
              const hit = rows.filter((r) => q.filters.every((f) => f(r)));
              if (q.update) { log.writes.push({ payload: { ...q.update }, matched: hit.length }); for (const r of hit) Object.assign(r, q.update); }
              return { data: hit.map((r) => ({ billid: r.billid })), error: null };
            })().then(res, rej);
          }
          return (...a) => {
            if (k === "eq" || k === "is") q.filters.push((r) => r[a[0]] === a[1]);
            else if (k === "update") q.update = a[0];
            else if (k !== "select") throw new Error(`fake db: unmodelled method ${String(k)}`);
            return b;
          };
        },
      });
      return b;
    },
  };
}
const bill = (o = {}) => ({
  billid: ID, billcaseid: 990810, billdate: "2026-05-04", billhours: 1.5, billbalance: 300, billreports: null, billfilename: null,
  billnotice: "1st", billpaiddate: null, billestimate: false, billpriority: null, billcomments: null,
  billsecondnoticedate: null, billfinalnoticedate: null, billtype: "depo", supersedesbillid: null, ...o,
});
const sessionClient = (role) => ({
  auth: { getUser: async () => ({ data: { user: { id: "qa-u", email: "qa@example.test" } } }) },
  from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { role, personid: 7 } }) }) }) }),
});
const SEP12_NOON_NY = new Date("2026-09-12T16:00:00Z");
async function act(kind, db, fields, { role = "admin", now = SEP12_NOON_NY } = {}) {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.set(k, v);
  let url;
  await assert.rejects(runNoticeAction(kind, ID, f, {
    session: () => requireSession("admin", sessionClient(role)),
    db: () => db,
    now: () => now,
    revalidatePath: () => {},
    redirect: (u) => { url = u; throw new Error("NEXT_REDIRECT"); },
  }), /NEXT_REDIRECT/);
  return url;
}
const html = (b, admin = true) => renderToStaticMarkup(React.createElement(BillView, {
  data: { bill: b, casetitle: "QA v. Invented", activity: [], revisedBy: [] },
  admin, ...(admin ? { action: async () => {}, advance: async () => {}, close: async () => {} } : {}),
}));
const buttons = (h) => [...h.matchAll(/<button[^>]*>([^<]*)<\/button>/g)].map((m) => m[1]);
const options = (h) => {
  const sel = h.match(/<select name="target"[^>]*>([\s\S]*?)<\/select>/);
  return sel ? [...sel[1].matchAll(/<option value="([^"]*)"/g)].map((m) => m[1]).filter(Boolean) : null;
};
const OK = `/bills/${ID}?saved=1`, STALE = `/bills/${ID}?error=stale`, MOVE = `/bills/${ID}?error=move`, FORBIDDEN = `/bills/${ID}?error=forbidden`;

test("QA advance 1st → 2nd → Final: dates stamped once each, second date kept, nothing else touched", async () => {
  const db = fakeDb([bill()]);
  assert.equal(await act("advance", db, { expected: "1st" }), OK);
  assert.deepEqual(db.log.writes, [{ payload: { billnotice: "2nd", billsecondnoticedate: "2026-09-12" }, matched: 1 }]);
  assert.equal(await act("advance", db, { expected: "2nd" }, { now: new Date("2026-10-20T15:00:00Z") }), OK);
  assert.deepEqual(db.rows[0], bill({ billnotice: "Final", billsecondnoticedate: "2026-09-12", billfinalnoticedate: "2026-10-20" }));
  assert.deepEqual(db.log.writes[1], { payload: { billnotice: "Final", billfinalnoticedate: "2026-10-20" }, matched: 1 });
  assert.equal(await act("advance", db, { expected: "Final" }), MOVE, "Final cannot advance");
  assert.equal(db.log.writes.length, 2);
});

test("QA render: Advance button text per notice; Final has none; closed bills have no notice controls; staff sees none", () => {
  assert.ok(buttons(html(bill())).includes("Advance to 2nd"));
  assert.ok(buttons(html(bill({ billnotice: "2nd" }))).includes("Advance to Final"));
  const fin = buttons(html(bill({ billnotice: "Final" })));
  assert.equal(fin.filter((t) => t.startsWith("Advance")).length, 0, JSON.stringify(fin));
  assert.ok(fin.includes("Close bill"));
  for (const n of ["Partial Payment", "Deadbeat"]) assert.equal(buttons(html(bill({ billnotice: n }))).filter((t) => t.startsWith("Advance")).length, 0, n);
  assert.deepEqual(options(html(bill({ billnotice: "2nd" }))), ["Cancelled", "Carried Over", "Deadbeat", "Settled"]);
  assert.deepEqual(options(html(bill({ billnotice: "Deadbeat" }))), ["Cancelled", "Carried Over", "Settled"]);
  for (const n of ["Paid", "Cancelled", "Carried Over", "Settled", "Refund", "Credit"]) {
    const h = html(bill({ billnotice: n }));
    assert.deepEqual(buttons(h), ["Update bill"], n);
    assert.equal(options(h), null, n);
  }
  const staff = html(bill(), false);
  assert.deepEqual(buttons(staff), []);
  assert.equal(options(staff), null);
});

test("QA close as Cancelled on a 2nd bill (and a Final bill): only billnotice written, both notice dates unchanged", async () => {
  const two = fakeDb([bill({ billnotice: "2nd", billsecondnoticedate: "2026-06-03" })]);
  assert.equal(await act("close", two, { expected: "2nd", target: "Cancelled" }), OK);
  assert.deepEqual(two.rows[0], bill({ billnotice: "Cancelled", billsecondnoticedate: "2026-06-03" }));
  const fin = fakeDb([bill({ billnotice: "Final", billsecondnoticedate: "2026-06-03", billfinalnoticedate: "2026-07-08" })]);
  assert.equal(await act("close", fin, { expected: "Final", target: "Cancelled" }), OK);
  assert.deepEqual(fin.rows[0], bill({ billnotice: "Cancelled", billsecondnoticedate: "2026-06-03", billfinalnoticedate: "2026-07-08" }));
});

test("QA close-as payload is exactly { billnotice } for every target — never a date column or billpaiddate", async () => {
  for (const target of ["Cancelled", "Carried Over", "Deadbeat", "Settled"]) {
    const db = fakeDb([bill({ billnotice: "2nd", billsecondnoticedate: "2026-06-03" })]);
    assert.equal(await act("close", db, { expected: "2nd", target }), OK, target);
    assert.deepEqual(db.log.writes, [{ payload: { billnotice: target }, matched: 1 }], target);
  }
});

test("QA Paid bill: advance and close-as both refused with exact codes; row byte-identical; no row matched", async () => {
  const paid = () => bill({ billnotice: "Paid", billpaiddate: "2026-08-01", billsecondnoticedate: "2026-07-01" });
  const cases = [
    ["advance", { expected: "Paid" }, MOVE],
    ["close", { expected: "Paid", target: "Cancelled" }, MOVE],
    ["advance", { expected: "1st" }, STALE], // stale form rendered while the bill was 1st
    ["close", { expected: "2nd", target: "Settled" }, STALE],
  ];
  for (const [kind, fields, want] of cases) {
    const db = fakeDb([paid()]);
    assert.equal(await act(kind, db, fields), want, `${kind} ${fields.expected}`);
    assert.deepEqual(db.rows[0], paid(), `${kind} ${fields.expected}`);
    assert.ok(db.log.writes.every((w) => w.matched === 0), `${kind} ${fields.expected}`);
  }
});

test("QA every closed notice: neither action changes the row (right-notice forms and stale 1st forms)", async () => {
  for (const n of ["Paid", "Cancelled", "Carried Over", "Settled", "Refund", "Credit"]) {
    for (const [kind, fields] of [["advance", { expected: n }], ["close", { expected: n, target: "Deadbeat" }], ["advance", { expected: "1st" }], ["close", { expected: "1st", target: "Settled" }]]) {
      const db = fakeDb([bill({ billnotice: n })]);
      assert.match(await act(kind, db, fields), /\?error=(move|stale)$/, `${n} ${kind} ${fields.expected}`);
      assert.deepEqual(db.rows[0], bill({ billnotice: n }), `${n} ${kind} ${fields.expected}`);
    }
  }
});

test("QA targets 'Paid' / 'Partial Payment' (and junk) refused with move and zero writes, from every open notice", async () => {
  for (const expected of ["1st", "2nd", "Final", "Partial Payment", "Deadbeat"]) {
    for (const target of ["Paid", "Partial Payment", "1st", "", "cancelled"]) {
      const db = fakeDb([bill({ billnotice: expected })]);
      assert.equal(await act("close", db, { expected, target }), MOVE, `${expected} → ${target}`);
      assert.deepEqual(db.log.writes, [], `${expected} → ${target}`);
    }
  }
});

test("QA no action ever writes billpaiddate, 'Paid' or 'Partial Payment' (every expected × every action)", async () => {
  const notices = ["1st", "2nd", "Final", "Partial Payment", "Deadbeat", "Paid", "Cancelled", "Carried Over", "Settled", "Refund", "Credit"];
  const payloads = [];
  for (const n of notices) {
    for (const [kind, extra] of [["advance", {}], ...["Cancelled", "Carried Over", "Deadbeat", "Settled", "Paid", "Partial Payment"].map((t) => ["close", { target: t }])]) {
      const db = fakeDb([bill({ billnotice: n })]);
      await act(kind, db, { expected: n, ...extra });
      payloads.push(...db.log.writes.map((w) => w.payload));
    }
  }
  assert.ok(payloads.length > 0);
  for (const p of payloads) {
    assert.ok(!("billpaiddate" in p), JSON.stringify(p));
    assert.ok(!["Paid", "Partial Payment"].includes(p.billnotice), JSON.stringify(p));
  }
});

test("QA staff: both actions forbidden before any DB access (zero from() calls, zero writes)", async () => {
  const db = fakeDb([bill({ billnotice: "2nd" })]);
  assert.equal(await act("advance", db, { expected: "2nd" }, { role: "staff" }), FORBIDDEN);
  assert.equal(await act("close", db, { expected: "2nd", target: "Cancelled" }, { role: "staff" }), FORBIDDEN);
  assert.deepEqual([db.log.from, db.log.writes.length], [0, 0]);
  assert.deepEqual(db.rows[0], bill({ billnotice: "2nd" }));
});

test("QA already-stamped notice dates are never overwritten: 1st with second date, 2nd with final date → stale", async () => {
  const a = fakeDb([bill({ billsecondnoticedate: "2026-05-05" })]);
  assert.equal(await act("advance", a, { expected: "1st" }), STALE);
  assert.deepEqual(a.rows[0], bill({ billsecondnoticedate: "2026-05-05" }));
  const b = fakeDb([bill({ billnotice: "2nd", billsecondnoticedate: "2026-06-01", billfinalnoticedate: "2026-06-30" })]);
  assert.equal(await act("advance", b, { expected: "2nd" }), STALE);
  assert.deepEqual(b.rows[0], bill({ billnotice: "2nd", billsecondnoticedate: "2026-06-01", billfinalnoticedate: "2026-06-30" }));
});

test("QA duplicate submit of the same Advance form → stale, bill stays at 2nd with the first stamp", async () => {
  const db = fakeDb([bill()]);
  assert.equal(await act("advance", db, { expected: "1st" }), OK);
  assert.equal(await act("advance", db, { expected: "1st" }, { now: new Date("2026-09-20T16:00:00Z") }), STALE);
  assert.deepEqual(db.rows[0], bill({ billnotice: "2nd", billsecondnoticedate: "2026-09-12" }));
});

test("QA concurrent: two Advance submits of the same 1st form, serialized at the write → one saved, one stale, bill at 2nd", async () => {
  let waiting = 0, open;
  const bothIn = new Promise((r) => (open = r));
  let chain = Promise.resolve();
  // Hold both requests until each has reached its update, then let them apply strictly one after the other.
  const db = fakeDb([bill()], async () => {
    if (++waiting === 2) open();
    await bothIn;
    const turn = chain; let done; chain = new Promise((r) => (done = r)); await turn; queueMicrotask(done);
  });
  const urls = await Promise.all([act("advance", db, { expected: "1st" }), act("advance", db, { expected: "1st" })]);
  assert.deepEqual(urls.sort(), [STALE, OK]);
  assert.deepEqual(db.log.writes.map((w) => w.matched).sort(), [0, 1]);
  assert.deepEqual(db.rows[0], bill({ billnotice: "2nd", billsecondnoticedate: "2026-09-12" }));
});

test("QA TZ: process on UTC; 23:30 New York stamps the New York date (EDT and EST), 00:30 NY the new day", async () => {
  assert.equal(new Date("2026-09-13T03:30:00Z").getTimezoneOffset(), 0, "process TZ must be UTC for this test to mean anything");
  assert.equal(new Date("2026-09-13T03:30:00Z").getDate(), 13);
  for (const [iso, want] of [["2026-09-13T03:30:00Z", "2026-09-12"], ["2027-01-16T04:30:00Z", "2027-01-15"], ["2026-09-13T04:30:00Z", "2026-09-13"]]) {
    const db = fakeDb([bill()]);
    assert.equal(await act("advance", db, { expected: "1st" }, { now: new Date(iso) }), OK, iso);
    assert.equal(db.rows[0].billsecondnoticedate, want, iso);
  }
});
