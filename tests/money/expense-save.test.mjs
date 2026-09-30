// Unit tests for lib/expenses/save.ts through runSaveExpense (the real action body) with a fake PostgREST proxy.
import { test } from "node:test";
import assert from "node:assert/strict";
import { runSaveExpense, parseMoney } from "../../lib/expenses/save.ts";
import { listActiveTypes } from "../../lib/expenses/types.ts";

/** Fake PostgREST builder (tests/cases/create.test.mjs shape); each statement's result comes from `route(stmt)`. */
function fakeDb(route) {
  const calls = [];
  return {
    calls,
    from(table) {
      const stmt = [["from", table]];
      calls.push(stmt);
      const b = new Proxy({}, {
        get(_, k) {
          if (k === "then") return (res, rej) => Promise.resolve(route(stmt)).then(res, rej);
          return (...args) => { stmt.push([k, ...args]); return b; };
        },
      });
      return b;
    },
  };
}
const op = (stmt, k) => stmt.find((c) => c[0] === k);
const writes = (db, k) => db.calls.filter((s) => op(s, k));

/** tblcase has 90001, tblexptype has 5 (active) and 6 (retired), tblexpenses has 12 (type 6). */
const route = (stmt) => {
  const table = stmt[0][1];
  const eq = Object.fromEntries(stmt.filter((c) => c[0] === "eq").map((c) => [c[1], c[2]]));
  if (op(stmt, "insert")) return { data: { expid: 7 }, error: null };
  // An update with no expid filter hits every row (as PostgREST would), so a dropped filter still "saves".
  if (op(stmt, "update")) return { data: !("expid" in eq) ? [{ expid: 12 }, { expid: 99 }] : eq.expid === 12 ? [{ expid: 12 }] : [], error: null };
  if (table === "tblcase") return { data: eq.caseid === 90001 ? { caseid: 90001 } : null, error: null };
  if (table === "tblexptype") return { data: eq.exptypeid === 5 && eq.active === true ? { exptypeid: 5 } : null, error: null };
  if (table === "tblexpenses") return { data: eq.expid === 12 ? { expid: 12, exptype: 6, expamount: 45 } : null, error: null };
  return { data: null, error: null };
};

const form = (over = {}) => {
  const f = new FormData();
  const base = { date: "2026-09-14", dscr: "Postage", checknum: "1001", type: "5", branch: "Stratford", amount: "45.00", ...over };
  for (const [k, v] of Object.entries(base)) f.set(k, v);
  return f;
};
async function run(id, over) {
  const db = fakeDb(route);
  const urls = [];
  await runSaveExpense(id, form(over), {
    session: async () => ({ userId: "u", email: "s@x", role: "staff", personId: 1 }),
    db: () => db,
    revalidatePath: () => {},
    redirect: (u) => urls.push(u),
  });
  return { db, url: urls.at(-1) };
}

test("new with no case → one insert with expcaseid null (firm-wide), no tblcase read", async () => {
  const { db, url } = await run(null, {});
  assert.equal(url, "/expenses/7?saved=1");
  const ins = writes(db, "insert");
  assert.equal(ins.length, 1);
  assert.equal(op(ins[0], "insert")[1].expcaseid, null);
  assert.equal(op(ins[0], "insert")[1].expamount, "45.00");
  assert.equal(db.calls.some((s) => s[0][1] === "tblcase"), false);
});

test("case 999999999 → case field error and zero inserts reach the DB", async () => {
  const { db, url } = await run(null, { case: "999999999" });
  assert.equal(writes(db, "insert").length, 0, "zero inserts reached the fake DB");
  assert.match(url, /^\/expenses\/new\?error=case&/);
});

test("case 90001 (exists) → insert carries expcaseid 90001", async () => {
  const { db } = await run(null, { case: "90001" });
  assert.equal(op(writes(db, "insert")[0], "insert")[1].expcaseid, 90001);
});

test("edit 12: amount 50 → payload 50.00, no expid in payload, filtered by expid 12", async () => {
  const { db, url } = await run(12, { amount: "50", type: "6" }); // type 6 is retired but is the row's current type
  assert.equal(url, "/expenses/12?saved=1");
  const [upd] = writes(db, "update");
  const payload = op(upd, "update")[1];
  assert.equal(payload.expamount, "50.00");
  assert.equal("expid" in payload, false);
  assert.deepEqual(op(upd, "eq"), ["eq", "expid", 12]);
});

test("edit unknown id → notfound, no update", async () => {
  const { db, url } = await run(13, {});
  assert.match(url, /^\/expenses\/13\?error=notfound/);
  assert.equal(writes(db, "update").length, 0);
});

for (const checknum of ["", "12.5", "abc", "-3"]) {
  test(`check number ${JSON.stringify(checknum)} → checknum error before any DB call`, async () => {
    const { db, url } = await run(null, { checknum });
    assert.match(url, /error=checknum/);
    assert.equal(db.calls.length, 0);
  });
}

test("retired type on a new expense → type error, no insert", async () => {
  const { db, url } = await run(null, { type: "6" });
  assert.match(url, /error=type/);
  assert.equal(writes(db, "insert").length, 0);
});

test("type options (listActiveTypes) exclude retired and legacy-null types", async () => {
  const rows = [{ exptypeid: 5, exptype: "Postage", active: true }, { exptypeid: 6, exptype: "Old", active: false }, { exptypeid: 7, exptype: "Legacy", active: null }];
  const db = fakeDb((stmt) => ({ data: rows.filter((r) => stmt.filter((c) => c[0] === "eq").every(([, c, v]) => r[c] === v)), error: null }));
  assert.deepEqual((await listActiveTypes(db)).map((t) => t.exptypeid), [5]);
});

test("parseMoney: fixed 2-decimal strings, rejects 3 decimals", () => {
  assert.equal(parseMoney("45", "amount"), "45.00");
  assert.equal(parseMoney("$1,234.5", "amount"), "1234.50");
  assert.equal(parseMoney("0.1", "amount"), "0.10");
  assert.throws(() => parseMoney("1.005", "amount"), { code: "amount" });
  assert.throws(() => parseMoney("", "amount"), { code: "amount" });
});
