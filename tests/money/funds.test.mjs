// Unit tests for lib/funds (money parser + create/update action bodies) with a fake PostgREST client.
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseMoney } from "../../lib/funds/money.ts";
import { runCreateFunds, runUpdateFunds, caseFundsDefaults, runCaseFundsDefaults, FUNDS_TYPES, FUNDS_FIELDS } from "../../lib/funds/save.ts";
import { renderToStaticMarkup } from "react-dom/server";
import React, { createElement } from "react";
globalThis.React = React; // tsx compiles app JSX with the classic runtime
import { FundsForm } from "../../app/funds/funds-form.tsx";

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

for (const [amount, want] of [["1234567.10", "1234567.10"], ["0.10", "0.10"], ["19.90", "19.90"]]) {
  test(`create: no-float write — amount ${amount} → fndspmt exactly the string "${want}"`, async () => {
    const db = okDb();
    await runCreateFunds(form({ amount }), deps(db));
    const w = writes(db);
    assert.equal(w.length, 1);
    assert.strictEqual(w[0][1].fndspmt, want);
  });
}

test("create: case-exists select on tblcase runs before the insert", async () => {
  const db = okDb();
  await runCreateFunds(form(), deps(db));
  const iCase = db.calls.findIndex((c) => c[0] === "from" && c[1] === "tblcase");
  const iIns = db.calls.findIndex((c) => c[0] === "insert");
  assert.ok(iCase >= 0 && iCase < iIns, "tblcase lookup precedes insert");
  assert.ok(db.calls.some((c) => c[0] === "eq" && c[1] === "caseid" && c[2] === 990901));
});

test("list: /funds query orders fndsdate desc, then fndsid desc (newest first)", async () => {
  const { listRecentFunds } = await import("../../lib/funds/save.ts");
  const db = fakeDb(() => ({ data: [{ fndsid: 2 }, { fndsid: 1 }], error: null }));
  const rows = await listRecentFunds(db);
  const orders = db.calls.filter((c) => c[0] === "order").map((c) => [c[1], c[2]?.ascending]);
  assert.deepEqual(orders, [["fndsdate", false], ["fndsid", false]]);
  assert.deepEqual(rows.map((r) => r.fndsid), [2, 1]);
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

  // Pre-read finds the row (same case, unlinked); the update then matches zero rows (deleted meanwhile).
  const isUpdate = (calls) => calls.slice(calls.findLastIndex((c) => c[0] === "from")).some((c) => c[0] === "update");
  const gone = fakeDb((calls) => (lastFrom(calls) === "tblcase" ? { data: { caseid: 990901 }, error: null }
    : isUpdate(calls) ? { data: [], error: null } : { data: { fndsid: 5, fndscaseid: 990901, fndsbillid: null }, error: null }));
  const d2 = deps(gone);
  await runUpdateFunds(5, form(), d2);
  assert.match(d2.redirected, /^\/funds\/5\?error=notfound/);
});

test("ticket 9 reopen: typed case number returns Source/Description defaults; bad/unknown/failed read gives blanks", async () => {
  const blank = { source: "", description: "" };
  const rows = { tblcase: { casetitle: "Sample v. Example", caseatty: 5 }, tblattorney: { attyfirstname: "Pat", attylastname: "Example" } };
  const db = fakeDb((calls) => ({ data: rows[lastFrom(calls)] ?? null, error: null }));
  let signedIn = 0;
  const deps = (d) => ({ session: async () => { signedIn++; }, db: () => d });
  assert.deepEqual(await runCaseFundsDefaults(" 990901 ", deps(db)), { source: "Example, Pat", description: "Sample v. Example" });
  assert.equal(signedIn, 1);
  assert.deepEqual(await runCaseFundsDefaults("990902", deps(fakeDb(() => ({ data: null, error: null })))), blank); // unknown case
  const n = db.calls.length;
  for (const bad of ["", "abc", "0", "12x", "1234567890"]) assert.deepEqual(await runCaseFundsDefaults(bad, deps(db)), blank);
  assert.equal(db.calls.length, n); // invalid input never reaches the DB
  assert.deepEqual(await runCaseFundsDefaults("1", deps(fakeDb(() => ({ data: null, error: { message: "boom" } })))), blank); // read failure
  await assert.rejects(runCaseFundsDefaults("1", { session: async () => { throw new Error("unauthorized"); }, db: () => db })); // auth gate
  assert.equal(writes(db).length, 0);
});

test("ticket 9: Type presets, Source/Description from the case, hidden fields still round-trip", async () => {
  assert.deepEqual(FUNDS_TYPES, ["Initial advance", "Subsequent advance", "Bill full payment", "Bill partial payment", "Other (see notes)"]);
  const rows = { tblcase: { casetitle: "Sample v. Example", caseatty: 5 }, tblattorney: { attyfirstname: "Pat", attylastname: "Example" } };
  const db = fakeDb((calls) => ({ data: rows[lastFrom(calls)] ?? null, error: null }));
  assert.deepEqual(await caseFundsDefaults(db, 990901), { source: "Example, Pat", description: "Sample v. Example" });
  assert.deepEqual(await caseFundsDefaults(fakeDb(() => ({ data: null, error: null })), 1), { source: "", description: "" });
  const values = Object.fromEntries(FUNDS_FIELDS.map((k) => [k, ""]));
  const html = renderToStaticMarkup(createElement(FundsForm, { values: { ...values, branch: "Stratford", bankaccount: "1234", cleared: "on", datecleared: "2026-01-02" }, action: () => {}, submitLabel: "Save" }));
  assert.match(html, /<datalist id="f-type-options">(<option value="[^"]+"><\/option>|<option value="[^"]+"\/>){5}<\/datalist>/);
  assert.match(html, /name="type"[^>]*list="f-type-options"|list="f-type-options"[^>]*name="type"/);
  for (const [k, v] of [["branch", "Stratford"], ["bankaccount", "1234"], ["cleared", "on"], ["datecleared", "2026-01-02"]]) {
    assert.match(html, new RegExp(`type="hidden"[^>]*name="${k}"[^>]*value="${v}"|name="${k}"[^>]*type="hidden"[^>]*value="${v}"|type="hidden"[^>]*value="${v}"[^>]*name="${k}"`));
  }
  assert.doesNotMatch(html, /Bank account|Bank clearing|>Branch</);
});
