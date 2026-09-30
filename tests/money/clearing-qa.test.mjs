// QA unit gaps for the clearing view (runClearRows): kind namespaces, the mirrored partial failure, a mixed X+Y
// submission, and note/date on decoys. Shared fake DB applies unfiltered writes to every row.
import { test } from "node:test";
import assert from "node:assert/strict";
import { fakeDb } from "./fakedb.mjs";
import { runClearRows, listUncleared } from "../../lib/bank-import/clearing.ts";

const exp = (expid, o = {}) => ({ expid, expdate: "2026-01-10", expdscr: `exp ${expid}`, expamount: "10.00", expbankaccount: "X", expclearedbank: false, expdatecleared: null, expclearingnotes: "orig", ...o });
const fnd = (fndsid, o = {}) => ({ fndsid, fndsdate: "2026-01-11", fndspayee: `payee ${fndsid}`, fndsdesc: "ck", fndspmt: "20.00", fndsbankaccount: "X", fndsclearedbank: false, fndsdatecleared: null, fndsclearingnotes: "orig", ...o });
// Same numeric id in both tables (7), a reversal pair (21 / -21), a Y row and a cleared row per table.
const world = () => ({
  tblexpenses: [exp(7), exp(8), exp(9, { expbankaccount: "Y" }), exp(10, { expclearedbank: true, expdatecleared: "2025-01-01", expclearingnotes: "old" })],
  tblfundsrcvd: [fnd(7), fnd(21), fnd(-21, { fndspmt: "-20.00", fndstype: "Bounced" }), fnd(22, { fndsbankaccount: "Y" }), fnd(23, { fndsclearedbank: true, fndsdatecleared: "2025-01-01", fndsclearingnotes: "old" })],
});
const form = (o, exps = [], fnds = []) => {
  const f = new FormData();
  for (const [k, v] of Object.entries({ account: "X", date: "2026-02-01", note: "", ...o })) f.set(k, v);
  for (const v of exps) f.append("exp", v);
  for (const v of fnds) f.append("fnd", v);
  return f;
};
const deps = (db, role = "staff") => {
  const d = { urls: [], db: () => db, revalidatePath: () => {}, redirect: (u) => d.urls.push(u) };
  d.session = async () => ({ userId: "u", email: "e", role, personId: 1 });
  return d;
};
const q = (u) => Object.fromEntries(new URL(u, "http://x").searchParams);
const snap = (db) => JSON.parse(JSON.stringify(db.tables));
const row = (db, t, k, id) => db.tables[t].find((r) => r[k] === id);

test("kind namespaces: exp=7 clears expense 7 only, never funds 7 (and vice versa)", async () => {
  let db = fakeDb(world());
  let before = snap(db);
  await runClearRows(form({}, ["7"]), deps(db));
  assert.equal(row(db, "tblexpenses", "expid", 7).expclearedbank, true);
  assert.deepEqual(db.tables.tblfundsrcvd, before.tblfundsrcvd);
  db = fakeDb(world());
  before = snap(db);
  await runClearRows(form({}, [], ["7"]), deps(db));
  assert.equal(row(db, "tblfundsrcvd", "fndsid", 7).fndsclearedbank, true);
  assert.deepEqual(db.tables.tblexpenses, before.tblexpenses);
});

test("reversal: fnd=-21 clears the negative reversal row only; original 21 untouched", async () => {
  const db = fakeDb(world());
  const before = snap(db);
  const d = deps(db);
  await runClearRows(form({ note: "bounce" }, [], ["-21"]), d);
  assert.deepEqual([row(db, "tblfundsrcvd", "fndsid", -21).fndsclearedbank, row(db, "tblfundsrcvd", "fndsid", -21).fndsdatecleared, row(db, "tblfundsrcvd", "fndsid", -21).fndsclearingnotes], [true, "2026-02-01", "bounce"]);
  assert.deepEqual(row(db, "tblfundsrcvd", "fndsid", 21), before.tblfundsrcvd.find((r) => r.fndsid === 21));
  assert.deepEqual(q(d.urls[0]), { account: "X", cleared: "1", skipped: "0" });
});

test("mixed submit: X rows + Y rows (both tables) with account X → only the X rows change", async () => {
  const db = fakeDb(world());
  const before = snap(db);
  const d = deps(db, "admin");
  await runClearRows(form({ note: "n" }, ["8", "9"], ["21", "22"]), d);
  assert.equal(row(db, "tblexpenses", "expid", 8).expclearedbank, true);
  assert.equal(row(db, "tblfundsrcvd", "fndsid", 21).fndsclearedbank, true);
  assert.deepEqual(row(db, "tblexpenses", "expid", 9), before.tblexpenses.find((r) => r.expid === 9));
  assert.deepEqual(row(db, "tblfundsrcvd", "fndsid", 22), before.tblfundsrcvd.find((r) => r.fndsid === 22));
  assert.deepEqual(q(d.urls[0]), { account: "X", cleared: "2", skipped: "2" });
});

test("account Y selected: X row ids submitted are not updated (reverse direction)", async () => {
  const db = fakeDb(world());
  const before = snap(db);
  await runClearRows(form({ account: "Y" }, ["7", "8"], ["7", "21", "-21"]), deps(db));
  assert.deepEqual(db.tables, before);
});

test("already-cleared row resubmitted with a note: old date and note kept", async () => {
  const db = fakeDb(world());
  const before = snap(db);
  await runClearRows(form({ note: "new" }, ["10"], ["23"]), deps(db));
  assert.deepEqual(db.tables, before);
});

test("partial (mirror): expenses update errors, funds clear → clearfailed=expenses, funds cleared, expenses untouched", async () => {
  const db = fakeDb(world());
  const real = db.from.bind(db);
  db.from = (t) => {
    const b = real(t);
    if (t !== "tblexpenses") return b;
    const upd = b.update;
    b.update = (p) => { upd(p); b.then = (res) => Promise.resolve({ data: null, error: { message: "boom" } }).then(res); return b; };
    return b;
  };
  const d = deps(db);
  await runClearRows(form({}, ["8"], ["21"]), d);
  assert.equal(row(db, "tblexpenses", "expid", 8).expclearedbank, false);
  assert.equal(row(db, "tblfundsrcvd", "fndsid", 21).fndsclearedbank, true);
  assert.deepEqual(q(d.urls[0]), { account: "X", cleared: "1", skipped: "0", clearfailed: "expenses" });
});

test("list after clear: cleared rows gone, reversal pair listed until cleared, Y and cleared rows never listed", async () => {
  const db = fakeDb(world());
  const ids = async () => (await listUncleared(db, "X")).map((r) => `${r.kind}:${r.id}`).sort();
  assert.deepEqual(await ids(), ["Expense:7", "Expense:8", "Funds:-21", "Funds:21", "Funds:7"].sort());
  await runClearRows(form({}, ["8"], ["-21"]), deps(db));
  assert.deepEqual(await ids(), ["Expense:7", "Funds:21", "Funds:7"].sort());
  assert.deepEqual((await listUncleared(db, "Y")).map((r) => `${r.kind}:${r.id}`).sort(), ["Expense:9", "Funds:22"]);
});

test("session failure propagates: no write, no redirect", async () => {
  const db = fakeDb(world());
  const before = snap(db);
  const d = deps(db);
  d.session = async () => { throw new Error("NEXT_REDIRECT /login"); };
  await assert.rejects(runClearRows(form({}, ["8"]), d), /login/);
  assert.deepEqual(db.tables, before);
  assert.equal(d.urls.length, 0);
});
