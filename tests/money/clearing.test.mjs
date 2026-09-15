// Unit tests: clearing view (runClearRows / listUncleared) over the shared fake DB.
// Decoys per filter on each table's clear update (all uncleared, opposite of what the write sets):
//   id filter      — row on account X, uncleared, NOT submitted (expid 3 / fndsid 13)
//   account filter — row on account Y, uncleared, submitted (expid 4 / fndsid -14, a reversal row)
//   uncleared flag — row on X, submitted, already cleared with an old date/note (expid 5 / fndsid 15)
import { test } from "node:test";
import assert from "node:assert/strict";
import { fakeDb } from "./fakedb.mjs";
import { runClearRows, listUncleared, parseIds } from "../../lib/bank-import/clearing.ts";

const exp = (expid, o = {}) => ({ expid, expdate: "2026-01-10", expdscr: `exp ${expid}`, expamount: "10.00", expbankaccount: "X", expclearedbank: false, expdatecleared: null, expclearingnotes: "orig", ...o });
const fnd = (fndsid, o = {}) => ({ fndsid, fndsdate: "2026-01-11", fndspayee: `payee ${fndsid}`, fndsdesc: "ck", fndspmt: "20.00", fndsbankaccount: "X", fndsclearedbank: null, fndsdatecleared: null, fndsclearingnotes: "orig", ...o });
const OLD = { expclearedbank: true, expdatecleared: "2025-01-01", expclearingnotes: "old" };
const OLDF = { fndsclearedbank: true, fndsdatecleared: "2025-01-01", fndsclearingnotes: "old" };
const world = () => ({
  tblexpenses: [exp(1), exp(2), exp(3), exp(4, { expbankaccount: "Y" }), exp(5, OLD)],
  tblfundsrcvd: [fnd(11), fnd(-12), fnd(13), fnd(-14, { fndsbankaccount: "Y" }), fnd(15, OLDF)],
});
const form = (o, exps = [], fnds = []) => {
  const f = new FormData();
  for (const [k, v] of Object.entries({ account: "X", date: "2026-02-01", note: "", ...o })) f.set(k, v);
  for (const v of exps) f.append("exp", v);
  for (const v of fnds) f.append("fnd", v);
  return f;
};
function deps(db) {
  const d = { urls: [] };
  d.session = async () => ({ userId: "u", email: "e", role: "staff", personId: 1 });
  d.db = () => db;
  d.revalidatePath = () => {};
  d.redirect = (u) => { d.urls.push(u); };
  return d;
}
const q = (u) => Object.fromEntries(new URL(u, "http://x").searchParams);
const e = (db, id) => db.tables.tblexpenses.find((r) => r.expid === id);
const f = (db, id) => db.tables.tblfundsrcvd.find((r) => r.fndsid === id);
const snapshot = (db) => JSON.parse(JSON.stringify(db.tables));

test("list: only uncleared rows on the account (null and false count as uncleared), both kinds", async () => {
  const rows = await listUncleared(fakeDb(world()), "X");
  assert.deepEqual(rows.map((r) => `${r.kind}:${r.id}`).sort(), ["Expense:1", "Expense:2", "Expense:3", "Funds:-12", "Funds:11", "Funds:13"].sort());
});

test("clear: two selected rows get cleared true + 2026-02-01 + note; decoys (unselected, other account, already cleared) untouched", async () => {
  const db = fakeDb(world());
  const before = snapshot(db);
  const d = deps(db);
  await runClearRows(form({ note: "stmt feb" }, ["1", "4", "5"], ["-12", "-14", "15"]), d);
  assert.deepEqual([e(db, 1).expclearedbank, e(db, 1).expdatecleared, e(db, 1).expclearingnotes], [true, "2026-02-01", "stmt feb"]);
  assert.deepEqual([f(db, -12).fndsclearedbank, f(db, -12).fndsdatecleared, f(db, -12).fndsclearingnotes], [true, "2026-02-01", "stmt feb"]);
  for (const id of [2, 3, 4, 5]) assert.deepEqual(e(db, id), before.tblexpenses.find((r) => r.expid === id), `exp ${id} untouched`);
  for (const id of [11, 13, -14, 15]) assert.deepEqual(f(db, id), before.tblfundsrcvd.find((r) => r.fndsid === id), `fnd ${id} untouched`);
  assert.deepEqual(q(d.urls[0]), { account: "X", cleared: "2", skipped: "4" });
  const left = (await listUncleared(db, "X")).map((r) => `${r.kind}:${r.id}`);
  assert.ok(!left.includes("Expense:1") && !left.includes("Funds:-12"), left.join());
});

test("clear: empty note keeps existing clearing notes", async () => {
  const db = fakeDb(world());
  await runClearRows(form({}, ["2"]), deps(db));
  assert.deepEqual([e(db, 2).expclearedbank, e(db, 2).expdatecleared, e(db, 2).expclearingnotes], [true, "2026-02-01", "orig"]);
});

test("clear: account Y row submitted with account X selected is not updated", async () => {
  const db = fakeDb(world());
  const before = snapshot(db);
  const d = deps(db);
  await runClearRows(form({}, ["4"], ["-14"]), d);
  assert.deepEqual(db.tables, before);
  assert.deepEqual(q(d.urls[0]), { account: "X", cleared: "0", skipped: "2" });
});

test("refusals: bad date, no rows, no account, too many → no write, clearerror code", async () => {
  for (const [o, exps, code] of [[{ date: "2026-02-30" }, ["1"], "date"], [{ date: "02/01/2026" }, ["1"], "date"], [{}, [], "none"],
    [{}, ["abc", "1.5"], "none"], [{ account: " " }, ["1"], "account"], [{}, Array.from({ length: 201 }, (_, i) => String(i + 1)), "toomany"]]) {
    const db = fakeDb(world());
    const before = snapshot(db);
    const d = deps(db);
    await runClearRows(form(o, exps), d);
    assert.equal(q(d.urls[0]).clearerror, code, JSON.stringify(o));
    assert.deepEqual(db.tables, before);
  }
});

test("partial: expenses clear, funds update errors → page told funds failed, expenses stay cleared", async () => {
  const db = fakeDb(world());
  const real = db.from.bind(db);
  db.from = (t) => {
    const b = real(t);
    if (t !== "tblfundsrcvd") return b;
    const upd = b.update;
    b.update = (p) => { upd(p); b.then = (res) => Promise.resolve({ data: null, error: { message: "boom" } }).then(res); return b; };
    return b;
  };
  const d = deps(db);
  await runClearRows(form({}, ["1"], ["11"]), d);
  assert.equal(e(db, 1).expclearedbank, true);
  assert.equal(f(db, 11).fndsclearedbank, null);
  assert.deepEqual(q(d.urls[0]), { account: "X", cleared: "1", skipped: "0", clearfailed: "funds" });
});

test("parseIds: integers only, negatives allowed, deduped", () => {
  assert.deepEqual(parseIds(["1", "1", "-14", " 7 ", "x", "1e3", "", "12345678901", null]), [1, -14, 7]);
});
