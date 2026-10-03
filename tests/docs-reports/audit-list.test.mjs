// /audit (admin audit-log list): changed-fields diff, query-string → PostgREST mapping, keyset paging,
// actor naming, and the admin gate. Recording fake: nothing here reaches a database.
import test from "node:test";
import assert from "node:assert/strict";
import { changedFields, parseFilters, queryAudit, runAuditList, actorName, loadActors, PAGE_SIZE } from "../../lib/audit/list.ts";
import { onlyForbidden } from "../../lib/auth/users.ts";

const U1 = "00000000-0000-4000-8000-000000000001";

// --- changed-fields diff -------------------------------------------------------------------------

test("changedFields: only differing fields, sorted, with old and new values", () => {
  const o = { id: 7, name: "Ann", amt: 10, tags: ["a"], note: null };
  const n = { id: 7, name: "Anne", amt: 10, tags: ["a", "b"], note: null };
  assert.deepEqual(changedFields(o, n), [
    { field: "name", from: "Ann", to: "Anne" },
    { field: "tags", from: ["a"], to: ["a", "b"] },
  ]);
});

test("changedFields: null↔value, 0/''/false are not null, key missing on one side counts, identical → empty", () => {
  assert.deepEqual(changedFields({ a: null, b: 0, c: "" }, { a: "x", b: null, c: "" }), [
    { field: "a", from: null, to: "x" },
    { field: "b", from: 0, to: null },
  ]);
  assert.deepEqual(changedFields({ a: 1 }, { a: 1, b: null }), [{ field: "b", from: null, to: null }]);
  assert.deepEqual(changedFields({ a: { x: 1 } }, { a: { x: 1 } }), []);
});

// --- filter → query mapping ----------------------------------------------------------------------

function recorder(result = { data: [], error: null }) {
  const calls = [];
  const b = new Proxy({}, {
    get: (_t, name) => name === "then" ? (res) => res(result) : (...args) => (calls.push([name, ...args]), b),
  });
  return { calls, db: { from: (t) => (calls.push(["from", t]), b) } };
}

test("parseFilters: valid values pass, malformed ones are dropped", () => {
  assert.deepEqual(parseFilters({ table: " tblcase ", rowid: "90001", actor: U1.toUpperCase(), from: "2026-01-02", to: "2026-02-03", before: "500" }),
    { table: "tblcase", rowid: "90001", actor: U1, from: "2026-01-02", to: "2026-02-03", before: 500 });
  assert.deepEqual(parseFilters({ actor: "none" }), { actor: "none" });
  assert.deepEqual(parseFilters({ actor: "x; drop", from: "2026-02-30", to: "yesterday", before: "-1" }), {});
  assert.deepEqual(parseFilters({ before: "0" }), {});
  assert.deepEqual(parseFilters({ before: "999999999999999" }), { before: 999999999999999 }, "15 digits is the cap");
  assert.deepEqual(parseFilters({ before: "1000000000000000" }), {}, "16 digits is dropped (beyond Number's safe range)");
  assert.deepEqual(parseFilters({ table: ["a", "b"] }), { table: "a" });
  assert.deepEqual(parseFilters({}), {});
});

test("queryAudit: no filters → newest-first by id, limit page+1, no where clauses", () => {
  const { db, calls } = recorder();
  queryAudit(db, {});
  assert.deepEqual(calls.map((c) => c[0]), ["from", "select", "order", "limit"]);
  assert.deepEqual(calls[0], ["from", "audit_log"]);
  assert.deepEqual(calls[2], ["order", "id", { ascending: false }]);
  assert.deepEqual(calls[3], ["limit", 51]);
});

test("PAGE_SIZE is 50", () => assert.equal(PAGE_SIZE, 50));

test("queryAudit: every filter becomes exactly its clause; `to` is inclusive; before is a keyset bound", () => {
  const { db, calls } = recorder();
  queryAudit(db, { table: "tblcase", rowid: "9", actor: U1, from: "2026-01-31", to: "2026-02-28", before: 123 });
  const where = calls.slice(2, -2);
  assert.deepEqual(where, [
    ["eq", "tablename", "tblcase"], ["eq", "rowid", "9"], ["eq", "actor", U1],
    ["gte", "at", "2026-01-31T00:00:00Z"], ["lt", "at", "2026-03-01T00:00:00Z"], ["lt", "id", 123],
  ]);
});

test("queryAudit: actor=none → IS NULL, not eq", () => {
  const { db, calls } = recorder();
  queryAudit(db, { actor: "none" });
  assert.deepEqual(calls[2], ["is", "actor", null]);
  assert.ok(!calls.some((c) => c[0] === "eq"));
});

// --- paging + actor naming (through the gate entry point) ----------------------------------------

const sessionClient = (role) => ({
  auth: { getUser: async () => ({ data: { user: { id: U1, email: "k@example.test" } } }) },
  from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: role ? { role, personid: 3 } : null }) }) }) }),
});

/** audit_log answers with `audit` rows (already sliced like PostgREST would), profiles/billing with fixtures. */
function world(audit) {
  const touched = [], auditCalls = [];
  return {
    touched, auditCalls,
    from(t) {
      touched.push(t);
      const out = t === "audit_log" ? audit : t === "profiles" ? [{ id: U1, email: "k@example.test", personid: 3 }] : [{ personid: 3, initials: "KP" }];
      const b = new Proxy({}, { get: (_x, n) => n === "then" ? (r) => r({ data: out, error: null }) : (...a) => (t === "audit_log" && auditCalls.push([n, ...a]), b) });
      return b;
    },
  };
}

test("runAuditList: 51 rows → trims to a 50-row page and returns the keyset cursor (last shown id)", async () => {
  const audit = Array.from({ length: 51 }, (_, i) => ({ id: 1000 - i, tablename: "t", rowid: "1", op: "UPDATE", olddata: {}, newdata: {}, actor: null, at: "2026-01-01T00:00:00Z" }));
  const p = await runAuditList({ db: world(audit), params: {}, client: sessionClient("admin") });
  assert.equal(p.rows.length, 50);
  assert.equal(p.nextBefore, 951);
  const last = await runAuditList({ db: world(audit.slice(0, 3)), params: {}, client: sessionClient("admin") });
  assert.equal(last.rows.length, 3);
  assert.equal(last.nextBefore, null);
});

test("runAuditList wires its params into the audit_log query (rowid → eq, before → lt id)", async () => {
  const db = world([]);
  await runAuditList({ db, params: { rowid: "9", before: "500" }, client: sessionClient("admin") });
  assert.ok(db.auditCalls.some((c) => c[0] === "eq" && c[1] === "rowid" && c[2] === "9"), JSON.stringify(db.auditCalls));
  assert.ok(db.auditCalls.some((c) => c[0] === "lt" && c[1] === "id" && c[2] === 500), JSON.stringify(db.auditCalls));
});

test("actorName: person → initials + email; null → system / unknown; deleted profile → short id", async () => {
  const actors = await loadActors(world([]));
  assert.equal(actorName(U1, actors), "KP (k@example.test)");
  assert.equal(actorName(null, actors), "system / unknown");
  assert.equal(actorName("deadbeef-0000-4000-8000-000000000009", actors), "former user (deadbeef)");
  // no billing initials → email alone
  assert.equal(actorName("a", new Map([["a", { id: "a", email: "e@x.test", initials: null }]])), "e@x.test");
});

// --- admin gate ----------------------------------------------------------------------------------

test("non-admin (staff) is refused with ForbiddenError and audit_log/profiles are never queried", async () => {
  const db = world([]);
  await assert.rejects(runAuditList({ db, params: {}, client: sessionClient("staff") }), { name: "ForbiddenError" });
  assert.deepEqual(db.touched, [], "no query before the admin check");
  // the page turns exactly that error into its 'Admins only' branch (null), and rethrows anything else
  assert.equal(await runAuditList({ db, params: {}, client: sessionClient("staff") }).catch(onlyForbidden), null);
});

test("no session → redirect to /login (not a render); admin → page", async () => {
  const db = world([]);
  await assert.rejects(runAuditList({ db, params: {}, client: sessionClient(null) }), /NEXT_REDIRECT/);
  assert.deepEqual(db.touched, []);
  const ok = await runAuditList({ db, params: {}, client: sessionClient("admin") });
  assert.deepEqual(ok.rows, []);
});
