// Unit tests for lib/funds/reverse.ts through a stateful fake PostgREST DB.
// The fake applies every recorded filter (an update with a dropped filter hits every row still matching) and enforces
// the tblfundsrcvd primary key on insert (23505), so the once-only guard is exercised the way Postgres enforces it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { runReverseFunds, reopenNotice, negateMoney, reversalComment } from "../../lib/funds/reverse.ts";

const NOW = new Date("2026-09-14T15:00:00Z"); // firm-local 2026-09-14

function fakeDb(tables, { insertGate } = {}) {
  const calls = [];
  return {
    calls, tables,
    from(table) {
      calls.push(["from", table]);
      const st = { table, op: "select", payload: null, filters: [] };
      const match = (r) => st.filters.every(([k, c, v]) => (k === "eq" ? r[c] === v : k === "is" ? r[c] === v : true));
      const run = async () => {
        if (st.op === "insert") {
          if (insertGate) await insertGate();
          const pk = table === "tblfundsrcvd" ? "fndsid" : null;
          if (pk && tables[table].some((r) => r[pk] === st.payload[pk])) return { data: null, error: { code: "23505", message: "duplicate key" } };
          tables[table].push({ ...st.payload });
          return { data: { ...st.payload }, error: null };
        }
        const rows = tables[table].filter(match);
        if (st.op === "update") rows.forEach((r) => Object.assign(r, st.payload));
        const out = rows.map((r) => ({ ...r }));
        return st.single ? { data: out[0] ?? null, error: null } : { data: out, error: null };
      };
      const b = new Proxy({}, {
        get(_, k) {
          if (k === "then") return (res, rej) => run().then(res, rej);
          return (...a) => {
            calls.push([k, ...a]);
            if (k === "update" || k === "insert") { st.op = k; st.payload = a[0]; }
            else if (k === "eq" || k === "is") st.filters.push([k, a[0], a[1]]);
            else if (k === "maybeSingle" || k === "single") st.single = true;
            return b;
          };
        },
      });
      return b;
    },
  };
}

const funds = (fndsid, fndspmt, extra = {}) => ({
  fndsid, fndscaseid: 990910, fndsdate: "2026-08-02", fndspmt, fndspayee: "Acme", fndssource: "Check 1001", fndsdesc: "retainer",
  fndsbranch: "Stratford", fndssafilename: null, fndsbillfilename: "b.pdf", fndscomment: "orig note", fndstype: "Check",
  fndsclearedbank: true, fndsdatecleared: "2026-08-05", fndsbankaccount: "BoA", fndsclearingnotes: "ok", ...extra,
});
const bill = (billid, billnotice, sec, fin, billcaseid = 990910) => ({
  billid, billcaseid, billnotice, billpaiddate: billnotice === "Paid" ? "2026-08-02" : null, billsecondnoticedate: sec, billfinalnoticedate: fin, billbalance: "450.00",
});
function world(opts) {
  return fakeDb({
    tblfundsrcvd: [funds(7, 450), funds(8, 1234567.1)],
    tblbills: [bill(21, "Paid", null, null), bill(22, "Paid", "2026-06-01", null), bill(23, "Paid", "2026-06-01", "2026-07-01"),
      bill(24, "1st", null, null), bill(25, "Paid", null, null, 990911)],
    tblcase: [{ caseid: 990910, numunpaidbills: 0 }],
  }, opts);
}
const form = (b) => { const f = new FormData(); if (b !== undefined) f.set("bill", b); return f; };
function deps(db, role = "admin") {
  const d = { redirected: null, revalidated: [] };
  d.session = async () => ({ userId: "u", email: "e", role, personId: 1 });
  d.db = () => db;
  d.now = () => NOW;
  d.revalidatePath = (p) => d.revalidated.push(p);
  d.redirect = (u) => { d.redirected = u; };
  return d;
}
const snap = (x) => JSON.parse(JSON.stringify(x));
const fr = (db, id) => db.tables.tblfundsrcvd.find((r) => r.fndsid === id);
const br = (db, id) => db.tables.tblbills.find((r) => r.billid === id);

test("reopen rule: Final > 2nd > 1st", () => {
  assert.equal(reopenNotice({ billfinalnoticedate: "2026-07-01", billsecondnoticedate: "2026-06-01" }), "Final");
  assert.equal(reopenNotice({ billfinalnoticedate: "2026-07-01", billsecondnoticedate: null }), "Final");
  assert.equal(reopenNotice({ billfinalnoticedate: null, billsecondnoticedate: "2026-06-01" }), "2nd");
  assert.equal(reopenNotice({ billfinalnoticedate: null, billsecondnoticedate: null }), "1st");
});

test("negation is exact 2-decimal string work", () => {
  assert.equal(negateMoney(1234567.1), "-1234567.10");
  assert.equal(negateMoney("450.00"), "-450.00");
  assert.equal(negateMoney(0.1), "-0.10");
  assert.equal(negateMoney(-450), null);
  assert.equal(negateMoney(0), null);
});

test("reverse 450.00, no bill: one -450.00 Bounced row with id -7, comment names 7; original byte-for-byte unchanged", async () => {
  const db = world();
  const before = snap(db.tables);
  const d = deps(db);
  await runReverseFunds(7, form(""), d);
  assert.equal(d.redirected, "/funds/7?reversed=-7");
  assert.deepEqual(fr(db, 7), before.tblfundsrcvd[0], "original unchanged");
  const r = db.tables.tblfundsrcvd.filter((x) => x.fndsid < 0);
  assert.equal(r.length, 1);
  assert.deepEqual(r[0], {
    fndsid: -7, fndscaseid: 990910, fndsdate: "2026-09-14", fndspmt: "-450.00", fndstype: "Bounced", fndscomment: "Reversal of fndsid 7",
    fndspayee: "Acme", fndssource: "Check 1001", fndsdesc: "retainer", fndsbranch: "Stratford", fndssafilename: null, fndsbillfilename: "b.pdf",
    fndsbankaccount: "BoA", fndsclearedbank: false, fndsdatecleared: null, fndsclearingnotes: null,
  });
  assert.equal(reversalComment(7), "Reversal of fndsid 7");
  assert.deepEqual(db.tables.tblbills, before.tblbills, "no bill written");
  assert.equal(db.calls.filter((c) => c[0] === "update").length, 0, "no update statement at all");
});

test("negation of 1234567.10 is the exact string -1234567.10", async () => {
  const db = world();
  await runReverseFunds(8, form(""), deps(db));
  assert.strictEqual(fr(db, -8).fndspmt, "-1234567.10");
});

for (const [billid, want] of [[21, "1st"], [22, "2nd"], [23, "Final"]]) {
  test(`reopen bill ${billid} → ${want}, billpaiddate null, notice dates/balance kept, other bills untouched`, async () => {
    const db = world();
    const before = snap(db.tables);
    const d = deps(db);
    await runReverseFunds(7, form(String(billid)), d);
    assert.equal(d.redirected, "/funds/7?reversed=-7");
    const b = br(db, billid);
    const o = before.tblbills.find((x) => x.billid === billid);
    assert.deepEqual(b, { ...o, billnotice: want, billpaiddate: null });
    for (const x of db.tables.tblbills.filter((x) => x.billid !== billid)) assert.deepEqual(x, before.tblbills.find((y) => y.billid === x.billid), `bill ${x.billid} untouched`);
    assert.deepEqual(db.tables.tblcase, before.tblcase, "tblcase untouched");
    assert.deepEqual(fr(db, 7), before.tblfundsrcvd[0]);
    assert.ok(d.revalidated.includes("/cases/990910") && d.revalidated.includes(`/bills/${billid}`));
    // Insert precedes the bill write.
    const ops = db.calls.filter((c) => c[0] === "insert" || c[0] === "update").map((c) => c[0]);
    assert.deepEqual(ops, ["insert", "update"]);
  });
}

test("reversing a reversal row is refused as 'reversal', nothing written", async () => {
  const db = world();
  await runReverseFunds(7, form(""), deps(db));
  const before = snap(db.tables);
  const d = deps(db);
  await runReverseFunds(-7, form(""), d);
  assert.equal(d.redirected, "/funds/-7?reverseerror=reversal");
  assert.deepEqual(db.tables, before);
});

test("a positive-id Bounced / negative-amount legacy row is refused as 'reversal'", async () => {
  const db = world();
  db.tables.tblfundsrcvd.push(funds(9, 100, { fndstype: "Bounced" }), funds(10, -100));
  const before = snap(db.tables);
  for (const id of [9, 10]) {
    const d = deps(db);
    await runReverseFunds(id, form(""), d);
    assert.equal(d.redirected, `/funds/${id}?reverseerror=reversal`);
  }
  assert.deepEqual(db.tables, before);
});

test("second sequential reversal → 'reversed', still exactly one reversal row, bill untouched", async () => {
  const db = world();
  await runReverseFunds(7, form(""), deps(db));
  const d = deps(db);
  await runReverseFunds(7, form("21"), d);
  assert.equal(d.redirected, "/funds/7?reverseerror=reversed");
  assert.equal(db.tables.tblfundsrcvd.filter((x) => x.fndsid === -7).length, 1);
  assert.equal(br(db, 21).billnotice, "Paid", "bill not reopened by the refused second submit");
});

test("interleaving: 5 concurrent submits all read before any insert → exactly one reversal, bill reopened once", async () => {
  let arrived = 0, release;
  const barrier = new Promise((r) => { release = r; });
  const db = world({ insertGate: async () => { if (++arrived === 5) release(); await barrier; } });
  const ds = Array.from({ length: 5 }, () => deps(db));
  await Promise.all(ds.map((d) => runReverseFunds(7, form("21"), d)));
  assert.equal(arrived, 5, "every request reached its insert (all prior reads passed)");
  assert.equal(db.tables.tblfundsrcvd.filter((x) => x.fndsid < 0).length, 1, "exactly one reversal row");
  const outs = ds.map((d) => d.redirected).sort();
  assert.deepEqual(outs, ["/funds/7?reversed=-7", "/funds/7?reverseerror=reversed", "/funds/7?reverseerror=reversed", "/funds/7?reverseerror=reversed", "/funds/7?reverseerror=reversed"]);
  assert.equal(br(db, 21).billnotice, "1st");
  assert.equal(db.calls.filter((c) => c[0] === "update").length, 1, "only the winner writes the bill");
});

test("bill must be Paid and on the funds case: open bill / other case's bill → 'bill', nothing written", async () => {
  for (const billid of [24, 25, 999]) {
    const db = world();
    const before = snap(db.tables);
    const d = deps(db);
    await runReverseFunds(7, form(String(billid)), d);
    assert.equal(d.redirected, "/funds/7?reverseerror=bill");
    assert.deepEqual(db.tables, before);
  }
});

test("bill moves off Paid between pre-check and write → reversal stands, billstale, bill untouched (the residual)", async () => {
  const db = world({ insertGate: async () => { br(db, 21).billnotice = "Settled"; } });
  const d = deps(db);
  await runReverseFunds(7, form("21"), d);
  assert.equal(d.redirected, "/funds/7?reverseerror=billstale");
  assert.equal(fr(db, -7).fndspmt, "-450.00");
  assert.equal(br(db, 21).billnotice, "Settled");
  assert.equal(br(db, 21).billpaiddate, "2026-08-02");
});

test("staff: forbidden, no DB call at all; ForbiddenError thrown by session is also forbidden", async () => {
  const db = world();
  const before = snap(db.tables);
  const d = deps(db, "staff");
  await runReverseFunds(7, form("21"), d);
  assert.equal(d.redirected, "/funds/7?reverseerror=forbidden");
  assert.equal(db.calls.length, 0);
  const d2 = deps(db);
  d2.session = async () => { const e = new Error("no"); e.name = "ForbiddenError"; throw e; };
  await runReverseFunds(7, form(""), d2);
  assert.equal(d2.redirected, "/funds/7?reverseerror=forbidden");
  assert.deepEqual(db.tables, before);
});

test("bad bill value / missing funds → typed refusal, nothing written", async () => {
  const db = world();
  const before = snap(db.tables);
  const d = deps(db);
  await runReverseFunds(7, form("21; drop"), d);
  assert.equal(d.redirected, "/funds/7?reverseerror=bill");
  const d2 = deps(db);
  await runReverseFunds(404, form(""), d2);
  assert.equal(d2.redirected, "/funds/404?reverseerror=notfound");
  assert.deepEqual(db.tables, before);
});
