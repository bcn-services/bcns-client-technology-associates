// Unit tests for lib/funds/pay.ts runPayBill through a stateful fake PostgREST DB.
// The fake applies every recorded filter; an update with a filter dropped hits every row that still matches.
import { test } from "node:test";
import assert from "node:assert/strict";
import { runPayBill, openBillsOldestFirst } from "../../lib/funds/pay.ts";

const FUNDS_DATE = "2026-08-02";
const TODAY = new Date().toISOString().slice(0, 10);

function fakeDb(tables) {
  const calls = [];
  return {
    calls, tables,
    from(table) {
      calls.push(["from", table]);
      const st = { table, op: "select", payload: null, filters: [], order: [] };
      const match = (r) => st.filters.every(([k, c, v]) => (k === "eq" ? r[c] === v : k === "in" ? v.includes(r[c]) : k === "is" ? r[c] === v : true));
      const run = () => {
        const rows = tables[table].filter(match);
        if (st.op === "update") rows.forEach((r) => Object.assign(r, st.payload));
        let out = rows.map((r) => ({ ...r }));
        for (const [c, o] of [...st.order].reverse()) out.sort((a, b) => (a[c] < b[c] ? -1 : a[c] > b[c] ? 1 : 0) * (o?.ascending === false ? -1 : 1));
        if (st.single) return { data: out[0] ?? null, error: null };
        return { data: out, error: null };
      };
      const b = new Proxy({}, {
        get(_, k) {
          if (k === "then") return (res, rej) => Promise.resolve(run()).then(res, rej);
          return (...a) => {
            calls.push([k, ...a]);
            if (k === "update") { st.op = "update"; st.payload = a[0]; }
            else if (k === "eq" || k === "in" || k === "is") st.filters.push([k, a[0], a[1]]);
            else if (k === "order") st.order.push([a[0], a[1]]);
            else if (k === "maybeSingle" || k === "single") st.single = true;
            return b;
          };
        },
      });
      return b;
    },
  };
}

/** Funds 7 on case 990900; bills: 11 open 1st (the target), 12 open 2nd same case, 13 Paid same case, 14 open 1st other case, 15 open 1st same case. */
function world() {
  const bill = (billid, billcaseid, billnotice, extra = {}) => ({
    billid, billcaseid, billnotice, billdate: `2026-0${billid - 10}-01`, billbalance: "640.00",
    billpaiddate: null, billsecondnoticedate: null, billfinalnoticedate: null, ...extra,
  });
  return fakeDb({
    tblfundsrcvd: [{ fndsid: 7, fndscaseid: 990900, fndsdate: FUNDS_DATE, fndsbillid: null }],
    tblbills: [
      bill(11, 990900, "1st", { billsecondnoticedate: "2026-07-01" }),
      bill(12, 990900, "2nd"),
      bill(13, 990900, "Paid", { billpaiddate: "2026-01-01" }),
      bill(14, 990901, "1st"),
      bill(15, 990900, "1st"),
    ],
    tblcase: [{ caseid: 990900, numunpaidbills: 3 }],
  });
}
function form(bill, kind) {
  const f = new FormData();
  f.set("bill", bill);
  f.set("kind", kind);
  return f;
}
function deps(db, role = "admin") {
  const d = { redirected: null, revalidated: [] };
  d.session = async () => ({ userId: "u", email: "e", role, personId: 1 });
  d.db = () => db;
  d.revalidatePath = (p) => d.revalidated.push(p);
  d.redirect = (u) => { d.redirected = u; };
  return d;
}
const snapshot = (db) => JSON.parse(JSON.stringify(db.tables));
const billRow = (db, id) => db.tables.tblbills.find((b) => b.billid === id);
const updates = (db) => db.calls.filter((c) => c[0] === "update" && !("fndsbillid" in c[1]));
/** Every table except bill 11 (and funds 7's link to it) is exactly as before. */
function onlyBill11Changed(db, before) {
  const after = snapshot(db);
  assert.deepEqual(after.tblcase, before.tblcase, "tblcase untouched");
  assert.deepEqual(after.tblfundsrcvd, before.tblfundsrcvd.map((f) => (f.fndsid === 7 ? { ...f, fndsbillid: 11 } : f)), "funds: only the link");
  for (const b of after.tblbills.filter((x) => x.billid !== 11)) assert.deepEqual(b, before.tblbills.find((x) => x.billid === b.billid), `bill ${b.billid} untouched`);
}

test("mark paid: bill 11 → Paid, billpaiddate = funds date; notice dates/balance kept; nothing else written", async () => {
  const db = world();
  const before = snapshot(db);
  const d = deps(db);
  await runPayBill(7, form("11:1st", "paid"), d);
  assert.equal(d.redirected, "/funds/7?paid=11");
  const b = billRow(db, 11);
  assert.equal(b.billnotice, "Paid");
  assert.equal(b.billpaiddate, FUNDS_DATE, "billpaiddate is the funds row's fndsdate");
  assert.notEqual(b.billpaiddate, TODAY);
  assert.equal(b.billsecondnoticedate, "2026-07-01");
  assert.equal(b.billfinalnoticedate, null);
  assert.equal(b.billbalance, "640.00");
  assert.deepEqual(updates(db).map((u) => u[1]), [{ billnotice: "Paid", billpaiddate: FUNDS_DATE }], "exact payload");
  onlyBill11Changed(db, before);
  assert.ok(d.revalidated.includes("/bills") && d.revalidated.includes("/cases/990900"));
});

test("partial payment: bill 11 → 'Partial Payment', exact payload, no billpaiddate", async () => {
  const db = world();
  const before = snapshot(db);
  const d = deps(db);
  await runPayBill(7, form("11:1st", "partial"), d);
  assert.equal(d.redirected, "/funds/7?paid=11");
  assert.equal(billRow(db, 11).billnotice, "Partial Payment");
  assert.equal(billRow(db, 11).billpaiddate, null);
  assert.deepEqual(updates(db).map((u) => u[1]), [{ billnotice: "Partial Payment" }]);
  onlyBill11Changed(db, before);
});

test("stale: bill 11 moved to 2nd after page load (posted 1st) → ?payerror=stale, nothing written", async () => {
  const db = world();
  billRow(db, 11).billnotice = "2nd";
  const before = snapshot(db);
  const d = deps(db);
  await runPayBill(7, form("11:1st", "paid"), d);
  assert.equal(d.redirected, "/funds/7?payerror=stale");
  assert.deepEqual(snapshot(db), before);
});

for (const notice of ["Paid", "Cancelled", "First"]) {
  test(`not open: posted expected '${notice}' is refused before any DB call (?payerror=bill)`, async () => {
    const db = world();
    const before = snapshot(db);
    const d = deps(db);
    await runPayBill(7, form(`13:${notice}`, "paid"), d);
    assert.equal(d.redirected, "/funds/7?payerror=bill");
    assert.equal(db.calls.length, 0);
    assert.deepEqual(snapshot(db), before);
  });
}

test("bill on another case (14) → bill (case checked before either write), nothing written", async () => {
  const db = world();
  const before = snapshot(db);
  const d = deps(db);
  await runPayBill(7, form("14:1st", "paid"), d);
  assert.equal(d.redirected, "/funds/7?payerror=bill");
  assert.deepEqual(snapshot(db), before);
});

test("staff session (no throw) → forbidden, no DB call", async () => {
  const db = world();
  const d = deps(db, "staff");
  await runPayBill(7, form("11:1st", "paid"), d);
  assert.equal(d.redirected, "/funds/7?payerror=forbidden");
  assert.equal(db.calls.length, 0);
});

test("requireSession('admin') ForbiddenError → forbidden, no DB call", async () => {
  const db = world();
  const d = deps(db);
  d.session = async () => { const e = new Error("requires role admin"); e.name = "ForbiddenError"; throw e; };
  await runPayBill(7, form("11:1st", "paid"), d);
  assert.equal(d.redirected, "/funds/7?payerror=forbidden");
  assert.equal(db.calls.length, 0);
});

test("unknown funds id → notfound; junk bill/kind → bill; nothing written", async () => {
  for (const [id, f, code] of [[99, form("11:1st", "paid"), "notfound"], [7, form("11", "paid"), "bill"], [7, form("11:1st", "delete"), "bill"]]) {
    const db = world();
    const before = snapshot(db);
    const d = deps(db);
    await runPayBill(id, f, d);
    assert.equal(d.redirected, `/funds/${id}?payerror=${code}`);
    assert.deepEqual(snapshot(db), before);
  }
});

test("openBillsOldestFirst: only open notices on that case, oldest first", async () => {
  const db = world();
  assert.deepEqual((await openBillsOldestFirst(db, 990900)).map((b) => b.billid), [11, 12, 15]);
});
