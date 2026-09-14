// Unit tests for lib/bills/create.ts through the real action body (runCreateBill + real requireSession) and the form view.
// The fake PostgREST APPLIES eq/in/is/insert/update/delete to its rows; `hook` lets a test act "concurrently". Expected values are literals.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

globalThis.React = React;
createRequire(import.meta.url)("react-dom").useFormStatus = () => ({ pending: false });
const { runCreateBill, loadNewBill } = await import("../../lib/bills/create.ts");
const { unbilledHours, listCaseTime } = await import("../../lib/time/case.ts");
const { NewBillForm } = await import("../../app/bills/new/new-bill-form.tsx");
const { requireSession } = await import("../../lib/auth/session.ts");

function fakeDb(tables, hook = () => {}) {
  const calls = [];
  let nextBill = 990700;
  return {
    calls,
    tables,
    from(table) {
      const q = { filters: [], update: null, insert: null, del: false, single: false, ops: [] };
      const b = new Proxy({}, {
        get(_, k) {
          if (k === "then") {
            hook(table, q, tables);
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
            const data = q.single ? rows[0] ?? null : rows.map((r) => ({ ...r }));
            return (res, rej) => Promise.resolve({ data, error: null }).then(res, rej);
          }
          return (...a) => {
            calls.push([table, k, ...a]);
            q.ops.push(k);
            if (k === "eq") q.filters.push((r) => r[a[0]] === a[1]);
            if (k === "in") q.filters.push((r) => a[1].includes(r[a[0]]));
            if (k === "is") q.filters.push((r) => r[a[0]] === a[1]);
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

const act = (actid, acthrs, o = {}) => ({ actid, actcaseid: 990600, actdate: "2026-09-01", actdescription: `Entry ${actid}`, acthrs, actwho: 1, actbilled: false, actbillid: null, ...o });
const world = (activity, hook) => fakeDb({
  tblcase: [{ caseid: 990600, casetitle: "Invented v. Fixture", caseatty: 77 }],
  tblattorney: [{ attyid: 77, attylastname: "Flood" }],
  tblbills: [],
  tblactivity: activity,
  tblbillingnames: [{ personid: 1, initials: "KJS" }],
}, hook);

const sessionClient = (role) => ({
  auth: { getUser: async () => ({ data: { user: { id: "u1", email: "x@example.test" } } }) },
  from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { role, personid: 1 } }) }) }) }),
});
function deps(db, role = "admin") {
  const out = { redirects: [] };
  out.deps = {
    session: () => requireSession("admin", sessionClient(role)),
    db: () => db,
    revalidatePath: () => {},
    redirect: (u) => { out.redirects.push(u); throw Object.assign(new Error("NEXT_REDIRECT"), { url: u }); },
  };
  return out;
}
const form = (o, actids = []) => {
  const f = new FormData();
  for (const [k, v] of Object.entries({ caseid: "990600", billtype: "timesheet", billdate: "2026-09-12", billbalance: "450.00", billnotice: "1st", ...o })) f.set(k, v);
  for (const id of actids) f.append("actid", String(id));
  return f;
};
const post = async (db, f, role) => {
  const d = deps(db, role);
  await assert.rejects(runCreateBill(f, d.deps), /NEXT_REDIRECT/);
  return d.redirects;
};

test("timesheet bill: 1.500 + 0.500 → billhours 2.000, notice 1st, filename -0, rows claimed, case unbilled 0.000", async () => {
  const db = world([act(1, "1.500"), act(2, "0.500"), act(3, "4.000", { actcaseid: 1 })]);
  assert.deepEqual(await post(db, form({}, [1, 2])), ["/bills/990700"]);
  assert.equal(db.tables.tblbills.length, 1);
  const b = db.tables.tblbills[0];
  assert.equal(b.billhours, "2.000");
  assert.equal(b.billnotice, "1st");
  assert.equal(b.billbalance, "450.00");
  assert.equal(b.billfilename, "Bill990600 Flood 2026 09 12-0");
  for (const id of [1, 2]) assert.deepEqual(db.tables.tblactivity.find((r) => r.actid === id), act(id, id === 1 ? "1.500" : "0.500", { actbilled: true, actbillid: 990700 }));
  assert.equal(db.tables.tblactivity.find((r) => r.actid === 3).actbilled, false);
  assert.equal(unbilledHours(await listCaseTime(db, 990600)), "0.000");
  // the write statement carries the guard
  const upd = db.calls.filter((c) => c[0] === "tblactivity").map((c) => c.slice(1, 3));
  assert.ok(JSON.stringify(upd).includes('["update",{"actbilled":true,"actbillid":990700}],["in","actid"],["eq","actbilled"],["is","actbillid"],["select","actid"]'));
});

test("second bill the same day on the case gets -1", async () => {
  const db = world([]);
  db.tables.tblbills.push({ billid: 5, billcaseid: 990600, billdate: "2026-09-12" }, { billid: 6, billcaseid: 990600, billdate: "2026-09-11" });
  await post(db, form({ billtype: "retainer" }));
  assert.equal(db.tables.tblbills.at(-1).billfilename, "Bill990600 Flood 2026 09 12-1");
});

test("retainer with nothing checked → billhours 0.000 and no tblactivity write", async () => {
  const db = world([act(1, "1.500")]);
  assert.deepEqual(await post(db, form({ billtype: "retainer", billbalance: "-25.10" })), ["/bills/990700"]);
  assert.equal(db.tables.tblbills[0].billhours, "0.000");
  assert.equal(db.tables.tblbills[0].billbalance, "-25.10");
  assert.equal(db.calls.some((c) => c[0] === "tblactivity"), false);
  assert.deepEqual(db.tables.tblactivity, [act(1, "1.500")]);
});

test("a typed hours/total field is ignored — hours come from the DB rows", async () => {
  const db = world([act(1, "1.500")]);
  await post(db, form({ billhours: "99", hours: "99", total: "99" }, [1]));
  assert.equal(db.tables.tblbills[0].billhours, "1.500");
});

test("stale: a checked row billed elsewhere after the form loaded → error=stale, no bill, other row still unbilled", async () => {
  const db = world([act(1, "1.500"), act(2, "0.500", { actbilled: true, actbillid: 42 })]);
  assert.deepEqual(await post(db, form({}, [1, 2])), ["/bills/new?case=990600&error=stale"]);
  assert.deepEqual(db.tables.tblbills, []);
  assert.deepEqual(db.tables.tblactivity, [act(1, "1.500"), act(2, "0.500", { actbilled: true, actbillid: 42 })]);
});

test("stale race: row billed between the read and the claim → compensation reverts + deletes the new bill", async () => {
  const hook = (table, q, t) => {
    if (table === "tblactivity" && q.update?.actbilled === true) Object.assign(t.tblactivity.find((r) => r.actid === 2), { actbilled: true, actbillid: 42 });
  };
  const db = world([act(1, "1.500"), act(2, "0.500")], hook);
  assert.deepEqual(await post(db, form({}, [1, 2])), ["/bills/new?case=990600&error=stale"]);
  assert.deepEqual(db.tables.tblbills, []);
  assert.deepEqual(db.tables.tblactivity.find((r) => r.actid === 1), act(1, "1.500"));
  assert.deepEqual(db.tables.tblactivity.find((r) => r.actid === 2), act(2, "0.500", { actbilled: true, actbillid: 42 }));
});

test("a checked actid from another case is refused as stale; nothing written", async () => {
  const db = world([act(1, "1.500"), act(9, "3.000", { actcaseid: 1 })]);
  assert.deepEqual(await post(db, form({}, [1, 9])), ["/bills/new?case=990600&error=stale"]);
  assert.deepEqual(db.tables.tblbills, []);
  assert.equal(db.tables.tblactivity.every((r) => r.actbilled === false), true);
});

test("staff POST through the real action body + real requireSession is refused; no DB call, no bill", async () => {
  const db = world([act(1, "1.500")]);
  assert.deepEqual(await post(db, form({}, [1]), "staff"), ["/bills/new?case=990600&error=forbidden"]);
  assert.deepEqual(db.calls, []);
  assert.deepEqual(db.tables.tblbills, []);
});

test("case with no attorney row → bill saved with billfilename null", async () => {
  const db = world([]);
  db.tables.tblattorney = [];
  await post(db, form({ billtype: "blank" }));
  assert.equal(db.tables.tblbills[0].billfilename, null);
});

test("bad balance / type / start status refused before any write", async () => {
  for (const [o, code] of [[{ billbalance: "12.345" }, "balance"], [{ billtype: "pdf" }, "type"], [{ billnotice: "Paid" }, "notice"]]) {
    const db = world([act(1, "1.500")]);
    assert.deepEqual(await post(db, form(o, [1])), [`/bills/new?case=990600&error=${code}`]);
    assert.equal(db.calls.some((c) => ["insert", "update", "delete"].includes(c[1])), false);
  }
});

test("form: timesheet default checks every unbilled row; one 'Unbilled hours' text, one Balance label, one Create bill button", async () => {
  const db = world([act(1, "1.500"), act(2, "0.500"), act(3, "2.000", { actbilled: true, actbillid: 42 })]);
  const data = await loadNewBill(db, 990600, new Date("2026-09-12T15:00:00Z"));
  const html = renderToStaticMarkup(React.createElement(NewBillForm, { data, action: () => {} }));
  assert.equal([...html.matchAll(/type="checkbox" name="actid"[^>]*checked=""/g)].length, 2);
  assert.doesNotMatch(html, /value="3"/);
  assert.equal(html.match(/unbilled hours/gi).length, 1);
  assert.match(html, /Unbilled hours: <span[^>]*>2\.000<\/span>/);
  assert.equal([...html.matchAll(/<label[^>]*>[^<]*balance/gi)].length, 1);
  assert.equal([...html.matchAll(/<button/g)].length, 1);
  assert.match(html, /<button[^>]*>Create bill<\/button>/);
  assert.match(html, /name="billdate"[^>]*value="2026-09-12"/);
  assert.doesNotMatch(html, /name="(billhours|hours|total)"/);
});
