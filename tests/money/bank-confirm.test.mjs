// Unit tests: review-inbox suggestion (pure) and confirm (runConfirmTransaction over the shared fake DB).
// Decoys, per filter: inbox tx 2 (differs from tx 1 only in id); type 3 = retired twin of active type 1 (differs only in
// `active`); pre-existing expenses 501/502 whose content equals what a confirm of tx 1 writes (differ only in expid).
import { test } from "node:test";
import assert from "node:assert/strict";
import { fakeDb } from "./fakedb.mjs";
import { suggestType, normalizeDescription } from "../../lib/bank-import/suggest.ts";
import { runConfirmTransaction } from "../../lib/bank-import/confirm.ts";

const EXPECTED = {
  expdate: "2026-01-15", expdscr: "COURT FILING FEE", expchecknum: 0, exptype: 1, expbranch: "Stratford", expamount: "45.00",
  expreason: null, expinit: null, expcaseid: null, expbillid: null, expclearedbank: true, expdatecleared: "2026-01-15",
  expbankaccount: "Ops 1234", expclearingnotes: null, exp_scanned_check_number: null, exp_notcountedinprofit: null,
};
const world = () => ({
  bank_transactions: [
    { id: 1, bankaccount: "Ops 1234", postedon: "2026-01-15", amount: "-45.00", description: "COURT FILING FEE", expid: null, fndsid: null },
    { id: 2, bankaccount: "Ops 1234", postedon: "2026-01-15", amount: "-45.00", description: "COURT FILING FEE", expid: null, fndsid: null },
  ],
  tblexptype: [
    { exptypeid: 1, exptype: "Filing Fee", active: true },
    { exptypeid: 2, exptype: "Case Material", active: true },
    { exptypeid: 3, exptype: "Filing Fee", active: false },
    { exptypeid: 4, exptype: "Legacy", active: null },
  ],
  tblcase: [{ caseid: 90001 }],
  tblexpenses: [{ ...EXPECTED, expid: 501 }, { ...EXPECTED, expid: 502, exptype: 2 }],
});
const form = (o = {}) => { const f = new FormData(); for (const [k, v] of Object.entries({ tx: "1", case: "", type: "1", dscr: "COURT FILING FEE", ...o })) f.set(k, v); return f; };
function deps(db) {
  const d = { urls: [], revalidated: [] };
  d.session = async () => ({ userId: "u", email: "e", role: "staff", personId: 1 });
  d.db = () => db;
  d.revalidatePath = (p) => d.revalidated.push(p);
  d.redirect = (u) => { d.urls.push(u); };
  return d;
}
const q = (u) => Object.fromEntries(new URL(u, "http://x").searchParams);
const newExp = (db) => db.tables.tblexpenses.filter((r) => r.expid > 502);
const tx = (db, id) => db.tables.bank_transactions.find((r) => r.id === id);

test("suggest: 3× Filing Fee vs 1× Case Material → Filing Fee for 'Court Filing Fee 0042'; unmatched → null; retired never suggested", () => {
  const past = [
    ...Array(3).fill({ expdscr: "COURT FILING FEE", exptype: 1 }),
    { expdscr: "COURT FILING FEE", exptype: 2 },
    { expdscr: "PROCESS SERVER", exptype: 2 },
  ];
  assert.equal(normalizeDescription("  Court  Filing\tFee 0042 "), "court filing fee");
  assert.equal(suggestType("Court Filing Fee 0042", past, new Set([1, 2])), 1);
  assert.equal(suggestType("STAPLES STORE 9", past, new Set([1, 2])), null);
  assert.equal(suggestType("Court Filing Fee 0042", past, new Set([2])), 2, "retired type 1 not counted");
  assert.equal(suggestType("1234", past, new Set([1, 2])), null, "digits-only description matches nothing");
});

test("confirm: one cleared tblexpenses row with the tx's date/amount/account, tx.expid linked, decoys untouched", async () => {
  const db = fakeDb(world());
  const d = deps(db);
  await runConfirmTransaction(form(), d);
  const rows = newExp(db);
  assert.equal(rows.length, 1);
  const { expid, ...rest } = rows[0];
  assert.deepEqual(rest, EXPECTED);
  assert.equal(tx(db, 1).expid, expid);
  assert.equal(tx(db, 2).expid, null, "decoy tx not linked");
  assert.deepEqual(db.tables.tblexpenses.map((r) => r.expid).slice(0, 2), [501, 502]);
  assert.deepEqual(q(d.urls[0]), { cleared: String(expid) });
  assert.ok(d.revalidated.includes("/bank-review"));
});

test("confirm with a case and an edited description writes them", async () => {
  const db = fakeDb(world());
  await runConfirmTransaction(form({ case: "90001", dscr: "  Filing fee, Smith  " }), deps(db));
  assert.deepEqual([newExp(db)[0].expcaseid, newExp(db)[0].expdscr], [90001, "Filing fee, Smith"]);
});

for (const [name, o, code] of [
  ["retired type (active=false)", { type: "3" }, "type"],
  ["legacy type (active=null)", { type: "4" }, "type"],
  ["no type", { type: "" }, "type"],
  ["unknown case", { case: "424242" }, "case"],
  ["blank description", { dscr: "  " }, "dscr"],
  ["unknown tx", { tx: "999" }, "notfound"],
  ["garbage tx", { tx: "1; drop" }, "notfound"],
]) {
  test(`confirm refused — ${name} → ?confirmerror=${code}, nothing written`, async () => {
    const db = fakeDb(world());
    const d = deps(db);
    await runConfirmTransaction(form(o), d);
    assert.equal(q(d.urls[0]).confirmerror, code);
    assert.equal(newExp(db).length, 0);
    assert.ok(!db.calls.some(([op, t]) => op !== "select" && t === "tblexpenses"), "no tblexpenses write");
    assert.equal(tx(db, 1).expid, null);
  });
}

test("already-linked tx → done, no insert", async () => {
  const w = world(); w.bank_transactions[0].expid = 501;
  const db = fakeDb(w);
  const d = deps(db);
  await runConfirmTransaction(form(), d);
  assert.deepEqual(q(d.urls[0]), { confirmerror: "done", confirmtx: "1" });
  assert.equal(newExp(db).length, 0);
});

test("interleaved double confirm: both read + insert before either links → exactly one expense; loser deletes only its own", async () => {
  let inserts = 0, release;
  const bothInserted = new Promise((r) => { release = r; });
  const db = fakeDb(world(), {
    hook: async (op, table) => {
      if (op === "insert" && table === "tblexpenses" && ++inserts === 2) release();
      if (op === "update" && table === "bank_transactions") await bothInserted;
    },
  });
  const a = deps(db), b = deps(db);
  await Promise.all([runConfirmTransaction(form(), a), runConfirmTransaction(form(), b)]);
  assert.equal(inserts, 2, "both requests really inserted");
  const rows = newExp(db);
  assert.equal(rows.length, 1, "exactly one new expense");
  assert.equal(tx(db, 1).expid, rows[0].expid);
  assert.deepEqual(db.tables.tblexpenses.map((r) => r.expid).filter((x) => x <= 502), [501, 502], "look-alike decoys kept");
  const outs = [a, b].map((d) => q(d.urls[0])).sort((x, y) => (x.cleared ? -1 : 1));
  assert.deepEqual(outs, [{ cleared: String(rows[0].expid) }, { confirmerror: "done", confirmtx: "1" }]);
});

test("tx gets a funds link between read and link → loser path: own expense removed, tx.expid stays null", async () => {
  const db = fakeDb(world(), {
    hook: async (op, table, tables) => { if (op === "update" && table === "bank_transactions") tables.bank_transactions[0].fndsid = 77; },
  });
  const d = deps(db);
  await runConfirmTransaction(form(), d);
  assert.equal(q(d.urls[0]).confirmerror, "done");
  assert.equal(newExp(db).length, 0);
  assert.equal(tx(db, 1).expid, null);
});

test("link DB error → own expense removed, ?confirmerror=failed", async () => {
  const db = fakeDb(world());
  const from = db.from.bind(db);
  db.from = (t) => {
    const b = from(t);
    if (t !== "bank_transactions") return b;
    const update = b.update;
    b.update = (p) => { update(p); return { eq: () => ({ is: () => ({ is: () => ({ select: async () => ({ data: null, error: { message: "boom" } }) }) }) }) }; };
    return b;
  };
  const d = deps(db);
  const err = console.error; console.error = () => {};
  try { await runConfirmTransaction(form(), d); } finally { console.error = err; }
  assert.equal(q(d.urls[0]).confirmerror, "failed");
  assert.equal(newExp(db).length, 0);
  assert.deepEqual(db.tables.tblexpenses.map((r) => r.expid), [501, 502]);
});
