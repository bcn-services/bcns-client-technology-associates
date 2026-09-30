// QA unit tests for item 8 (review inbox + confirm): inbox filter decoys, read path writes nothing, the exact
// ×3/×1 suggestion scenario with a heavier retired decoy, and the loser's compensating delete removes only its own expid.
import { test } from "node:test";
import assert from "node:assert/strict";
import { fakeDb } from "./fakedb.mjs";
import { suggestType } from "../../lib/bank-import/suggest.ts";
import { listInbox, listPastTypes, runConfirmTransaction } from "../../lib/bank-import/confirm.ts";
import { listActiveTypes } from "../../lib/expenses/types.ts";

const TX = { bankaccount: "Ops 1234", postedon: "2026-01-15", amount: "-45.00", description: "COURT FILING FEE" };
const world = () => ({
  bank_transactions: [
    { id: 1, ...TX, expid: null, fndsid: null },
    { id: 2, ...TX, expid: 501, fndsid: null }, // decoy: differs only in expid
    { id: 3, ...TX, expid: null, fndsid: 9 }, // decoy: differs only in fndsid
  ],
  tblexptype: [
    { exptypeid: 1, exptype: "Filing Fee", active: true },
    { exptypeid: 2, exptype: "Case Material", active: true },
    { exptypeid: 3, exptype: "Old Filing", active: false },
    { exptypeid: 4, exptype: "Legacy", active: null },
  ],
  tblcase: [],
  tblexpenses: [
    { expid: 501, expdate: "2026-01-15", expdscr: "COURT FILING FEE", exptype: 1, expamount: "45.00", expclearedbank: true, expdatecleared: "2026-01-15", expbankaccount: "Ops 1234" },
    { expid: 502, expdate: "2026-01-15", expdscr: "COURT FILING FEE", exptype: 1, expamount: "45.00", expclearedbank: true, expdatecleared: "2026-01-15", expbankaccount: "Ops 1234" },
  ],
});

test("listInbox: only rows with expid AND fndsid both null (decoys differ in one column each)", async () => {
  assert.deepEqual((await listInbox(fakeDb(world()))).map((r) => r.id), [1]);
});

test("guardrail: the page's read path (inbox, active types, past types) writes nothing to any table", async () => {
  const db = fakeDb(world());
  await Promise.all([listInbox(db), listActiveTypes(db), listPastTypes(db)]);
  assert.deepEqual(db.calls.filter(([op]) => op !== "select"), []);
  assert.equal(db.tables.tblexpenses.length, 2);
});

test("type select source: listActiveTypes has no retired (false) or legacy (null) type", async () => {
  const ids = (await listActiveTypes(fakeDb(world()))).map((t) => t.exptypeid).sort();
  assert.deepEqual(ids, [1, 2]);
});

test("suggest: 'COURT FILING FEE' ×3 Filing Fee, ×1 Case Material (+×5 retired decoy) → 'Court Filing Fee 0042' gets Filing Fee", () => {
  const past = [
    ...Array(3).fill({ expdscr: "COURT FILING FEE", exptype: 1 }),
    { expdscr: "COURT FILING FEE", exptype: 2 },
    ...Array(5).fill({ expdscr: "COURT FILING FEE", exptype: 3 }),
  ];
  const active = new Set([1, 2]);
  assert.equal(suggestType("Court Filing Fee 0042", past, active), 1);
  assert.equal(suggestType("court   filing fee 0042", past, active), 1, "case/whitespace-insensitive");
  assert.equal(suggestType("Court Filing Fees 0042", past, active), null, "unmatched → no preselect");
  assert.equal(suggestType("Court Filing Fee 0042", [], active), null, "no history → no preselect");
});

test("loser's compensating delete removes exactly its own just-inserted expid; winner + look-alikes kept", async () => {
  let inserts = 0, release, before;
  const bothInserted = new Promise((r) => { release = r; });
  const db = fakeDb(world(), {
    hook: async (op, table, tables) => {
      if (op === "insert" && table === "tblexpenses" && ++inserts === 2) release();
      if (op === "update" && table === "bank_transactions") await bothInserted;
      if (op === "delete") { assert.equal(table, "tblexpenses"); before = tables.tblexpenses.map((r) => r.expid); }
    },
  });
  const f = () => { const x = new FormData(); x.set("tx", "1"); x.set("case", ""); x.set("type", "1"); x.set("dscr", "COURT FILING FEE"); return x; };
  const d = () => ({ session: async () => ({ role: "staff" }), db: () => db, revalidatePath() {}, redirect(u) { this.url = u; } });
  const a = d(), b = d();
  await Promise.all([runConfirmTransaction(f(), a), runConfirmTransaction(f(), b)]);
  const winner = db.tables.bank_transactions.find((r) => r.id === 1).expid;
  const after = db.tables.tblexpenses.map((r) => r.expid);
  assert.deepEqual(before.sort(), [501, 502, 503, 504]);
  assert.deepEqual(after.sort(), [501, 502, winner].sort());
  assert.equal(db.calls.filter(([op]) => op === "delete").length, 1);
  assert.equal(db.tables.bank_transactions.find((r) => r.id === 2).expid, 501, "decoy tx untouched");
});
