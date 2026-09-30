// Unit tests for lib/expenses/list.ts against an in-memory PostgREST fake that really applies (or doesn't) each filter.
import { test } from "node:test";
import assert from "node:assert/strict";
import { listExpenses, monthBounds, parseMonth, parseCase } from "../../lib/expenses/list.ts";

const MAX_ROWS = 1000; // hosted PostgREST cap

/** Fake DB: each filter narrows the table; no filter → every row. Records every call; caps a response at MAX_ROWS. */
function fakeDb(tables) {
  const calls = [];
  return {
    calls,
    from(table) {
      calls.push(["from", table]);
      let rows = [...(tables[table] ?? [])];
      let range = null, wantCount = false;
      const orders = [];
      const b = new Proxy({}, {
        get(_, k) {
          if (k === "then") {
            const out = [...rows].sort((a, z) => { for (const c of orders) { if (a[c] < z[c]) return -1; if (a[c] > z[c]) return 1; } return 0; });
            const sliced = range ? out.slice(range[0], range[1] + 1) : out;
            return (res, rej) => Promise.resolve({ data: sliced.slice(0, MAX_ROWS), count: wantCount ? out.length : null, error: null }).then(res, rej);
          }
          return (...a) => {
            calls.push([k, ...a]);
            if (k === "select") wantCount = a[1]?.count === "exact";
            else if (k === "eq") rows = rows.filter((r) => r[a[0]] === a[1]);
            else if (k === "gte") rows = rows.filter((r) => r[a[0]] >= a[1]);
            else if (k === "lte") rows = rows.filter((r) => r[a[0]] <= a[1]);
            else if (k === "is") rows = rows.filter((r) => r[a[0]] === a[1]);
            else if (k === "not" && a[1] === "is") rows = rows.filter((r) => r[a[0]] !== a[2]);
            else if (k === "in") rows = rows.filter((r) => a[1].includes(r[a[0]]));
            else if (k === "order") orders.push(a[0]);
            else if (k === "range") range = [a[0], a[1]];
            else if (k === "insert" || k === "update" || k === "delete" || k === "upsert") rows = tables[table] ?? [];
            return b;
          };
        },
      });
      return b;
    },
  };
}
const WRITES = ["insert", "update", "delete", "upsert", "rpc"];
const writes = (db) => db.calls.filter((c) => WRITES.includes(c[0]));
const TYPES = [{ exptypeid: 1, exptype: "Filing fee" }, { exptypeid: 2, exptype: "Postage" }, { exptypeid: 3, exptype: "Courier" }];
let nextId = 1;
// Default is a case row so only the firm-wide test carries null-case rows (one signal per mutant).
const exp = (o) => ({ expid: nextId++, expcaseid: 990901, expdate: "2026-01-15", exptype: 1, expdscr: "x", expchecknum: 0, expamount: 1, expclearedbank: null, ...o });

test("parseMonth / parseCase / monthBounds: strings only, leap years", () => {
  assert.equal(parseMonth("2026-01"), "2026-01");
  for (const bad of ["2026-13", "2026-1", "", "abc", undefined]) assert.equal(parseMonth(bad), null, String(bad));
  assert.equal(parseCase("990901"), 990901);
  assert.equal(parseCase("99x"), null);
  assert.deepEqual(monthBounds("2026-01"), ["2026-01-01", "2026-01-31"]);
  assert.deepEqual(monthBounds("2024-02"), ["2024-02-01", "2024-02-29"]);
  assert.deepEqual(monthBounds("2026-02"), ["2026-02-01", "2026-02-28"]);
  assert.deepEqual(monthBounds("2026-04"), ["2026-04-01", "2026-04-30"]);
});

test("case filter: ?case=990901 lists only that case's rows, type NAME shown, total = their sum", async () => {
  const db = fakeDb({ tblexptype: TYPES, tblexpenses: [
    exp({ expcaseid: 990901, exptype: 2, expamount: 10.25 }), exp({ expcaseid: 990901, exptype: 3, expamount: 4.5 }),
    exp({ expcaseid: 990902, expamount: 100 }), exp({ expcaseid: null, expamount: 7 }),
  ] });
  const r = await listExpenses(db, { caseId: 990901, month: null });
  assert.equal(r.rows.length, 2, "only case 990901 rows");
  assert.deepEqual(r.rows.map((x) => x.typeName), ["Postage", "Courier"]);
  assert.equal(r.total, "14.75");
});

const boundary = () => fakeDb({ tblexptype: TYPES, tblexpenses: [
  exp({ expdate: "2025-12-31", expdscr: "dec31" }), exp({ expdate: "2026-01-01", expdscr: "jan1" }),
  exp({ expdate: "2026-01-31", expdscr: "jan31" }), exp({ expdate: "2026-02-01", expdscr: "feb1" }),
] });
test("month lower bound: Dec 31 excluded", async () => {
  const r = await listExpenses(boundary(), { caseId: null, month: "2026-01" });
  assert.ok(!r.rows.some((x) => x.expdscr === "dec31"), "Dec 31 row must not be listed");
});
test("month upper bound: Feb 1 excluded", async () => {
  const r = await listExpenses(boundary(), { caseId: null, month: "2026-01" });
  assert.ok(!r.rows.some((x) => x.expdscr === "feb1"), "Feb 1 row must not be listed");
});
test("month bounds inclusive: Jan 1 and Jan 31 both listed", async () => {
  const r = await listExpenses(boundary(), { caseId: null, month: "2026-01" });
  const got = r.rows.map((x) => x.expdscr);
  assert.ok(got.includes("jan1") && got.includes("jan31"), `Jan 1 and Jan 31 listed: ${got}`);
});

test("month: firm-wide (no case) rows are included alongside case rows", async () => {
  const db = fakeDb({ tblexptype: TYPES, tblexpenses: [exp({ expcaseid: null, expdscr: "firm" }), exp({ expcaseid: 990901, expdscr: "case" })] });
  const r = await listExpenses(db, { caseId: null, month: "2026-01" });
  assert.ok(r.rows.some((x) => x.expdscr === "firm"), "firm-wide row listed");
});

test("month: EVERY row of a 2,500-row month is listed and totalled (pages past the 1000-row cap)", async () => {
  const db = fakeDb({ tblexptype: TYPES, tblexpenses: Array.from({ length: 2500 }, (_, i) => exp({ expamount: 0.01, exptype: (i % 3) + 1 })) });
  const r = await listExpenses(db, { caseId: null, month: "2026-01" });
  assert.equal(r.rows.length, 2500);
  assert.equal(r.total, "25.00");
});

test("type names: one tblexptype query for many rows and types (never per row)", async () => {
  const db = fakeDb({ tblexptype: TYPES, tblexpenses: Array.from({ length: 30 }, (_, i) => exp({ exptype: (i % 3) + 1 })) });
  const r = await listExpenses(db, { caseId: null, month: "2026-01" });
  assert.equal(db.calls.filter((c) => c[0] === "from" && c[1] === "tblexptype").length, 1, "tblexptype query count");
  assert.deepEqual(new Set(r.rows.map((x) => x.typeName)), new Set(["Filing fee", "Postage", "Courier"]));
});

test("total: exact cents, no float — 0.10 + 0.20 = '0.30'", async () => {
  const db = fakeDb({ tblexptype: TYPES, tblexpenses: [exp({ expamount: 0.1 }), exp({ expamount: 0.2 })] });
  const r = await listExpenses(db, { caseId: null, month: "2026-01" });
  assert.equal(r.total, "0.30");
  assert.equal(r.totalCents, 30);
});
test("total: exact over 1000 × 9,999,999,999.99 (float sum drifts by cents here)", async () => {
  const db = fakeDb({ tblexptype: TYPES, tblexpenses: Array.from({ length: 1000 }, () => exp({ expamount: 9999999999.99 })) });
  const r = await listExpenses(db, { caseId: null, month: "2026-01" });
  assert.equal(r.totalCents, 999999999999000);
  assert.equal(r.total, "9,999,999,999,990.00");
});

test("read-only: listing issues zero insert/update/delete/upsert/rpc", async () => {
  const db = fakeDb({ tblexptype: TYPES, tblexpenses: [exp({ expcaseid: 990901 })] });
  await listExpenses(db, { caseId: 990901, month: "2026-01" });
  assert.deepEqual(writes(db), []);
});
