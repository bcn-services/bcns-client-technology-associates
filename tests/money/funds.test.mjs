// Unit tests for lib/funds (money parser + create/update action bodies) with a fake PostgREST client.
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseMoney } from "../../lib/funds/money.ts";
import { runCreateFunds, runUpdateFunds } from "../../lib/funds/save.ts";

/** Fake PostgREST builder: records every call; the terminal result comes from `result(calls)`. */
function fakeDb(result) {
  const calls = [];
  return {
    calls,
    from(table) {
      calls.push(["from", table]);
      const b = new Proxy({}, {
        get(_, k) {
          if (k === "then") return (res, rej) => Promise.resolve(result(calls)).then(res, rej);
          return (...args) => { calls.push([k, ...args]); return b; };
        },
      });
      return b;
    },
  };
}
const writes = (db) => db.calls.filter((c) => c[0] === "insert" || c[0] === "update");
const lastFrom = (calls) => calls.filter((c) => c[0] === "from").at(-1)?.[1];

/** Case 990901 exists; insert returns fndsid 77. */
const okDb = () => fakeDb((calls) => (lastFrom(calls) === "tblcase" ? { data: { caseid: 990901 }, error: null } : { data: { fndsid: 77 }, error: null }));
const noCaseDb = () => fakeDb((calls) => (lastFrom(calls) === "tblcase" ? { data: null, error: null } : { data: { fndsid: 77 }, error: null }));

function form(over = {}) {
  const f = new FormData();
  for (const [k, v] of Object.entries({ case: "990901", amount: "450.00", date: "2026-09-14", branch: "Stratford", payee: "Acme", ...over })) f.set(k, v);
  return f;
}
function deps(db, role = "staff") {
  const d = { redirected: null, revalidated: [] };
  d.session = async () => ({ userId: "u", email: "e", role, personId: 1 });
  d.db = () => db;
  d.revalidatePath = (p) => d.revalidated.push(p);
  d.redirect = (u) => { d.redirected = u; };
  return d;
}

test("parseMoney: normalizes to a 2-decimal string, refuses >2 decimals / junk / zero", () => {
  assert.equal(parseMoney("450"), "450.00");
  assert.equal(parseMoney("450.00"), "450.00");
  assert.equal(parseMoney(" $1,234.5 "), "1234.50");
  assert.equal(parseMoney("-12.34"), "-12.34");
  assert.equal(parseMoney("007.10"), "7.10");
  for (const bad of ["45.001", "abc", "", "0", "0.00", "1.2.3", "12345678901"]) assert.equal(parseMoney(bad), null, bad);
});

test("create: case 990901, 450.00 → one insert (fndspmt '450.00' string, Stratford) → /funds/77?saved=1", async () => {
  const db = okDb();
  const d = deps(db);
  await runCreateFunds(form({ branch: "" }), d);
  const w = writes(db);
  assert.equal(w.length, 1);
  assert.equal(w[0][0], "insert");
  assert.equal(w[0][1].fndspmt, "450.00");
  assert.equal(typeof w[0][1].fndspmt, "string");
  assert.equal(w[0][1].fndsbranch, "Stratford");
  assert.equal(w[0][1].fndscaseid, 990901);
  assert.equal(d.redirected, "/funds/77?saved=1");
});

for (const amount of ["45.001", "abc"]) {
  test(`create: amount ${amount} → ?error=amount, no DB call at all`, async () => {
    const db = okDb();
    const d = deps(db);
    await runCreateFunds(form({ amount }), d);
    assert.equal(db.calls.length, 0);
    const q = new URLSearchParams(d.redirected.split("?")[1]);
    assert.ok(d.redirected.startsWith("/funds/new?"));
    assert.equal(q.get("error"), "amount");
    assert.equal(q.get("amount"), amount);
  });
}

test("create: nonexistent case → ?error=case, no insert", async () => {
  const db = noCaseDb();
  const d = deps(db);
  await runCreateFunds(form({ case: "990999" }), d);
  assert.equal(writes(db).length, 0);
  assert.equal(new URLSearchParams(d.redirected.split("?")[1]).get("error"), "case");
});

test("create: ForbiddenError from the session → ?error=forbidden, no DB call", async () => {
  const db = okDb();
  const d = deps(db);
  d.session = async () => { const e = new Error("no"); e.name = "ForbiddenError"; throw e; };
  await runCreateFunds(form(), d);
  assert.equal(db.calls.length, 0);
  assert.match(d.redirected, /error=forbidden/);
});

test("update: writes one filtered update → /funds/5?saved=1; zero rows → notfound", async () => {
  const db = fakeDb((calls) => (lastFrom(calls) === "tblcase" ? { data: { caseid: 990901 }, error: null } : { data: [{ fndsid: 5 }], error: null }));
  const d = deps(db);
  await runUpdateFunds(5, form({ amount: "12.5" }), d);
  const w = writes(db);
  assert.equal(w.length, 1);
  assert.equal(w[0][1].fndspmt, "12.50");
  assert.ok(db.calls.some((c) => c[0] === "eq" && c[1] === "fndsid" && c[2] === 5));
  assert.equal(d.redirected, "/funds/5?saved=1");

  const gone = fakeDb((calls) => (lastFrom(calls) === "tblcase" ? { data: { caseid: 990901 }, error: null } : { data: [], error: null }));
  const d2 = deps(gone);
  await runUpdateFunds(5, form(), d2);
  assert.match(d2.redirected, /^\/funds\/5\?error=notfound/);
});
