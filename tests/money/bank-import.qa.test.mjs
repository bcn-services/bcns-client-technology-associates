// QA gap tests for lib/bank-import through the real runImportBank entry point with a recording fake DB.
import { test } from "node:test";
import assert from "node:assert/strict";
import { runImportBank } from "../../lib/bank-import/import.ts";

function recDb() {
  const calls = [], written = [];
  const b = (table) => new Proxy({}, {
    get(_, k) {
      if (k === "then") return (res) => res({ data: written.filter((w) => w.table === table && w.fresh).map(() => ({ id: 1 })), error: null });
      return (...a) => { calls.push([table, k]); if (k === "upsert" || k === "insert") [a[0]].flat().forEach((r) => written.push({ table, fresh: true, ...r })); return b(table); };
    },
  });
  return { calls, written, from: (t) => { calls.push([t, "from"]); return b(t); } };
}
const form = (csv, account = "QA Acct") => { const f = new FormData(); f.set("account", account); f.set("file", new File([csv], "e.csv")); return f; };
const deps = (db, session = async () => ({ role: "staff" })) => {
  const d = { url: null };
  Object.assign(d, { session, db: () => db, revalidatePath: () => {}, redirect: (u) => { d.url = u; } });
  return d;
};
const q = (d) => Object.fromEntries(new URL(d.url, "http://x").searchParams);
const H = "Date,Description,Amount\n";

test("unauthenticated: session rejection propagates; no DB call, no redirect to a result", async () => {
  const db = recDb();
  const d = deps(db, async () => { throw new Error("NEXT_REDIRECT /login"); });
  await assert.rejects(runImportBank(form(H + "2026-01-15,X,-1.00\n"), d), /login/);
  assert.deepEqual(db.calls, []);
  assert.equal(d.url, null);
});

test("all-or-nothing: bad line 3 between valid lines 2 and 4 → only line 3 named, zero DB calls", async () => {
  const db = recDb(), d = deps(db);
  await runImportBank(form(H + "2026-01-15,A,-1.00\n2026-13-01,B,-2.00\n2026-01-17,C,-3.00\n"), d);
  assert.equal(q(d).importerror, "parse");
  assert.equal(q(d).importdetail, 'Line 3: bad date "2026-13-01"');
  assert.deepEqual(db.calls, []);
});

test("line numbers are physical file lines across CRLF and blank lines", async () => {
  const db = recDb(), d = deps(db);
  await runImportBank(form("Date,Description,Amount\r\n\r\n2026-02-30,B,-2.00\r\n"), d);
  assert.equal(q(d).importdetail, 'Line 3: bad date "2026-02-30"');
  assert.deepEqual(db.calls, []);
});

test("call-trace: mixed debit/credit/duplicate file touches only bank_transactions and writes no credit", async () => {
  const db = recDb(), d = deps(db);
  await runImportBank(form(H + '2026-01-15,"SMITH, JONES LLP",-45.00\n2026-01-16,DEP,100.00\n2026-01-15,"SMITH, JONES LLP",-45.00\n'), d);
  assert.deepEqual([...new Set(db.calls.map((c) => c[0]))], ["bank_transactions"]);
  assert.ok(!db.calls.some((c) => ["update", "delete"].includes(c[1])));
  assert.ok(db.written.every((w) => w.amount.startsWith("-") && w.bankaccount === "QA Acct"));
  assert.equal(q(d).credits, "1");
});

test("admin session may upload too", async () => {
  const db = recDb(), d = deps(db, async () => ({ role: "admin" }));
  await runImportBank(form(H + "2026-01-15,X,-1.00\n"), d);
  assert.equal(q(d).imported, "1");
});
