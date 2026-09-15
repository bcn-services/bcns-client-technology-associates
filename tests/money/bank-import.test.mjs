// Unit tests for lib/bank-import through runImportBank and a stateful fake PostgREST DB.
// The fake enforces the frozen unique key (bankaccount, postedon, amount, description): a plain insert that collides
// fails the whole statement (23505, nothing written, like Postgres); upsert+ignoreDuplicates inserts only new rows and
// returns only those. Decoys: per key column, a pre-existing row matching the fixture on the other three columns only.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parseBoaCsv, splitCsvLine, parseDate } from "../../lib/bank-import/parse.ts";
import { runImportBank, resultLine } from "../../lib/bank-import/import.ts";

const FIXTURE = readFileSync(new URL("../journeys/fixtures/boa-export.csv", import.meta.url), "utf8");
const KEY = ["bankaccount", "postedon", "amount", "description"];
const keyOf = (r) => KEY.map((k) => String(r[k])).join("|");

function fakeDb(rows = []) {
  const calls = [];
  const tables = { bank_transactions: rows, tblexpenses: [], tblfundsrcvd: [] };
  return {
    calls, tables,
    from(table) {
      calls.push(["from", table]);
      const st = { op: "select", payload: null, opts: {} };
      const run = async () => {
        if (st.op === "select") return { data: tables[table].map((r) => ({ ...r })), error: null };
        const t = tables[table];
        const payload = [st.payload].flat();
        if (st.op === "insert" || !st.opts.ignoreDuplicates) {
          const seen = new Set(t.map(keyOf));
          for (const r of payload) { if (seen.has(keyOf(r))) return { data: null, error: { code: "23505", message: "duplicate key" } }; seen.add(keyOf(r)); }
          const out = payload.map((r) => ({ id: t.length + 1, ...r }));
          t.push(...out);
          return { data: out, error: null };
        }
        assert.equal(st.opts.onConflict, KEY.join(","), "conflict target is the frozen key");
        const out = [];
        for (const r of payload) {
          if (t.some((x) => keyOf(x) === keyOf(r))) continue;
          const row = { id: t.length + 1, ...r };
          t.push(row); out.push(row);
        }
        return { data: out.map((r) => ({ id: r.id })), error: null };
      };
      const b = new Proxy({}, {
        get(_, k) {
          if (k === "then") return (res, rej) => run().then(res, rej);
          return (...a) => {
            calls.push([k, ...a]);
            if (k === "insert" || k === "upsert") { st.op = k; st.payload = a[0]; st.opts = a[1] ?? {}; }
            return b;
          };
        },
      });
      return b;
    },
  };
}

// Per key column, one pre-existing row equal to fixture line 2 (acct "Ops 1234") in every key column but that one.
const decoys = () => [
  { id: 101, bankaccount: "Other Acct", postedon: "2026-01-15", amount: "-45.00", description: "COURT FILING FEE" },
  { id: 102, bankaccount: "Ops 1234", postedon: "2026-01-14", amount: "-45.00", description: "COURT FILING FEE" },
  { id: 103, bankaccount: "Ops 1234", postedon: "2026-01-15", amount: "-45.01", description: "COURT FILING FEE" },
  { id: 104, bankaccount: "Ops 1234", postedon: "2026-01-15", amount: "-45.00", description: "COURT FILING FEES" },
];

const form = (csv, account = "Ops 1234") => {
  const f = new FormData();
  f.set("account", account);
  if (csv !== null) f.set("file", new File([csv], "export.csv", { type: "text/csv" }));
  return f;
};
function deps(db) {
  const d = { redirected: null, revalidated: [], sessions: 0 };
  d.session = async () => { d.sessions++; return { userId: "u", email: "e", role: "staff", personId: 1 }; };
  d.db = () => db;
  d.revalidatePath = (p) => d.revalidated.push(p);
  d.redirect = (u) => { d.redirected = u; };
  return d;
}
const q = (d) => Object.fromEntries(new URL(d.redirected, "http://x").searchParams);
const ours = (db) => db.tables.bank_transactions.filter((r) => r.id < 100);
const upload = async (db, csv, account) => { const d = deps(db); await runImportBank(form(csv, account), d); return d; };

test("fixture upload (staff): 2 rows, amounts -45.00 / -75.00, bankaccount = form value; decoys do not count as imported", async () => {
  const db = fakeDb(decoys());
  const d = await upload(db, FIXTURE, "  Ops 1234  ");
  assert.equal(d.sessions, 1);
  assert.deepEqual(q(d), { account: "Ops 1234", imported: "2", already: "0", credits: "0" });
  assert.deepEqual(ours(db).map(({ id, ...r }) => r), [
    { bankaccount: "Ops 1234", postedon: "2026-01-15", amount: "-45.00", description: "COURT FILING FEE" },
    { bankaccount: "Ops 1234", postedon: "2026-01-16", amount: "-75.00", description: "PROCESS SERVER CO" },
  ]);
  assert.ok(d.revalidated.includes("/bank-review"));
  assert.equal(resultLine({ imported: 2, already: 0, credits: 0 }), "2 transactions imported, 0 already imported, 0 credits skipped");
});

test("account: the form value is written, not a default", async () => {
  const db = fakeDb();
  await upload(db, FIXTURE, "Chase Card 9876");
  assert.deepEqual(db.tables.bank_transactions.map((r) => r.bankaccount), ["Chase Card 9876", "Chase Card 9876"]);
});

test("second upload of the same file inserts 0 and reports 2 already imported; a mixed file inserts only the new row", async () => {
  const db = fakeDb(decoys());
  await upload(db, FIXTURE);
  const d = await upload(db, FIXTURE);
  assert.deepEqual(q(d), { account: "Ops 1234", imported: "0", already: "2", credits: "0" });
  assert.equal(ours(db).length, 2);
  const d2 = await upload(db, FIXTURE + "2026-01-17,NEW VENDOR,-10.00\n");
  assert.deepEqual(q(d2), { account: "Ops 1234", imported: "1", already: "2", credits: "0" });
  assert.equal(ours(db).length, 3);
});

test("the same line twice within one file: one row, the second counts as already imported", async () => {
  const db = fakeDb();
  const d = await upload(db, "Date,Description,Amount\n2026-01-15,DUP,-5.00\n2026-01-15,DUP,-5.00\n");
  assert.deepEqual(q(d), { account: "Ops 1234", imported: "1", already: "1", credits: "0" });
  assert.equal(db.tables.bank_transactions.length, 1);
});

test("bad date on line 3: error names line 3 and no DB call at all (all-or-nothing)", async () => {
  const db = fakeDb();
  const d = await upload(db, "Date,Description,Amount\n2026-01-15,GOOD ROW,-45.00\n2026-02-30,BAD DATE,-75.00\n");
  assert.equal(q(d).importerror, "parse");
  assert.match(q(d).importdetail, /^Line 3: bad date "2026-02-30"$/);
  assert.deepEqual(db.calls, [], "no DB call");
  assert.equal(db.tables.bank_transactions.length, 0);
});

test("quoted description with a comma parses as one field; +100.00 credit is skipped and counted", async () => {
  const db = fakeDb();
  const d = await upload(db, 'Date,Description,Amount\n2026-01-20,"SMITH, JONES LLP",-250.00\n2026-01-21,CLIENT DEPOSIT,100.00\n');
  assert.deepEqual(q(d), { account: "Ops 1234", imported: "1", already: "0", credits: "1" });
  assert.deepEqual(db.tables.bank_transactions.map((r) => [r.description, r.amount]), [["SMITH, JONES LLP", "-250.00"]]);
});

test("amount is written as the exact 2-decimal string, never a float", async () => {
  const db = fakeDb();
  await upload(db, "Date,Description,Amount\n2026-01-15,BIG,-1234567.10\n");
  assert.strictEqual(db.tables.bank_transactions[0].amount, "-1234567.10");
});

test("never writes tblexpenses or tblfundsrcvd", async () => {
  const db = fakeDb();
  await upload(db, FIXTURE);
  assert.deepEqual(db.calls.filter((c) => c[0] === "from").map((c) => c[1]), ["bank_transactions"]);
});

test("only-credits file: no DB call, counts credits", async () => {
  const db = fakeDb();
  const d = await upload(db, "Date,Description,Amount\n2026-01-21,DEP,100.00\n");
  assert.deepEqual(q(d), { account: "Ops 1234", imported: "0", already: "0", credits: "1" });
  assert.deepEqual(db.calls, []);
});

test("empty account / no file / DB error → typed errors; DB error reported as failed", async () => {
  const db = fakeDb();
  let d = await upload(db, FIXTURE, "   ");
  assert.equal(q(d).importerror, "account");
  d = await upload(db, null);
  assert.equal(q(d).importerror, "nofile");
  d = await upload(db, "");
  assert.equal(q(d).importerror, "nofile");
  assert.deepEqual(db.calls, []);
  const bad = { from: () => ({ upsert: () => ({ select: async () => ({ data: null, error: { message: "boom" } }) }) }) };
  const err = console.error; console.error = () => {};
  try { d = deps(bad); await runImportBank(form(FIXTURE), d); } finally { console.error = err; }
  assert.equal(q(d).importerror, "failed");
});

test("oversized file → toobig, no DB call", async () => {
  const db = fakeDb();
  const d = await upload(db, "Date,Description,Amount\n" + "2026-01-15,X,-1.00\n".repeat(60_000));
  assert.equal(q(d).importerror, "toobig");
  assert.deepEqual(db.calls, []);
});

test("parser: BOM, CRLF, trailing blank lines, escaped quotes, BoA mm/dd/yyyy dates, $ and thousands", () => {
  const r = parseBoaCsv('﻿Date,Description,Amount\r\n01/15/2026,"SAY ""HI"", CO","-$1,234.50"\r\n\r\n\r\n');
  assert.deepEqual(r, { ok: true, rows: [{ line: 2, postedon: "2026-01-15", description: 'SAY "HI", CO', amount: "-1234.50" }] });
  assert.deepEqual(splitCsvLine('a,"b,c",""'), ["a", "b,c", ""]);
  assert.equal(splitCsvLine('a,"b'), null);
  assert.equal(parseDate("2026-02-30"), null);
  assert.equal(parseDate("2024-02-29"), "2024-02-29");
  assert.equal(parseDate("13/01/2026"), null);
});

test("parser: header required; every bad line reported with its number", () => {
  assert.deepEqual(parseBoaCsv("2026-01-15,X,-1.00\n"), { ok: false, errors: ['Line 1: header must be "Date,Description,Amount"'] });
  const r = parseBoaCsv('Date,Description,Amount\n2026-01-15,OK,-1.00\nnope,X,-1\n2026-01-15,X,abc\n2026-01-15,"X,-1\n2026-01-15,X\n2026-01-15,,-1\n2026-01-15,X,0\n');
  assert.deepEqual(r, { ok: false, errors: [
    'Line 3: bad date "nope"', 'Line 4: bad amount "abc"', "Line 5: unbalanced quotes", "Line 6: expected 3 fields, found 2",
    "Line 7: missing description", 'Line 8: bad amount "0"',
  ] });
});
