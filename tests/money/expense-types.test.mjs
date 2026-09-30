// Unit tests for lib/expenses/types.ts with an in-memory fake PostgREST client that really evaluates filters.
import { test } from "node:test";
import assert from "node:assert/strict";
import { listActiveTypes, retireType, reactivateType, runAddType, runRetireType, runReactivateType } from "../../lib/expenses/types.ts";

/** In-memory fake: eq/order/select evaluated against `tables`; every op recorded in `calls`, writes in `writes`. */
function memDb(seed) {
  const tables = structuredClone(seed);
  const calls = [];
  const writes = [];
  return {
    tables, calls, writes,
    from(table) {
      const st = { table, op: "select", filters: [], order: null, payload: null };
      calls.push(st);
      const exec = () => {
        const rows = (tables[table] ??= []);
        const match = (r) => st.filters.every(([c, v, neg]) => (neg ? r[c] !== v : r[c] === v));
        if (st.op === "insert") {
          const id = Math.max(0, ...rows.map((r) => r.exptypeid ?? 0)) + 1;
          const row = { exptypeid: id, ...st.payload };
          rows.push(row); writes.push(["insert", table, row]);
          return { data: [row], error: null };
        }
        if (st.op === "update") {
          const hit = rows.filter(match);
          for (const r of hit) Object.assign(r, st.payload);
          writes.push(["update", table, st.payload, hit.length]);
          return { data: hit.map((r) => ({ ...r })), error: null };
        }
        if (st.op === "delete") {
          writes.push(["delete", table]);
          tables[table] = rows.filter((r) => !match(r));
          return { data: [], error: null };
        }
        let out = rows.filter(match).map((r) => ({ ...r }));
        if (st.order) out.sort((a, b) => String(a[st.order]).localeCompare(String(b[st.order])));
        return { data: out, error: null };
      };
      const b = {
        select() { return b; },
        insert(p) { st.op = "insert"; st.payload = p; return b; },
        update(p) { st.op = "update"; st.payload = p; return b; },
        delete() { st.op = "delete"; return b; },
        upsert(p) { st.op = "insert"; st.payload = p; return b; },
        eq(c, v) { st.filters.push([c, v]); return b; },
        neq(c, v) { st.filters.push([c, v, true]); return b; }, // lets a `.neq("active", false)` mutant run (and leak null)
        order(c) { st.order = c; return b; },
        then(res, rej) { return Promise.resolve().then(exec).then(res, rej); },
      };
      return b;
    },
  };
}

const SEED = {
  tblexptype: [
    { exptypeid: 1, exptype: "Postage", active: true },
    { exptypeid: 2, exptype: "Old Courier", active: false },
    { exptypeid: 3, exptype: "Legacy Misc", active: null },
    { exptypeid: 4, exptype: "Filing Fee", active: true },
  ],
  tblexpenses: [
    { expid: 11, exptype: 1, expamount: "12.50" },
    { expid: 12, exptype: 1, expamount: "3.00" },
  ],
};
const form = (o) => { const f = new FormData(); for (const [k, v] of Object.entries(o)) f.set(k, v); return f; };
const deps = (db, role) => {
  const out = { redirects: [] };
  out.deps = { session: async () => ({ userId: "u", email: "e", role, personId: 1 }), db: () => db, revalidatePath: () => {}, redirect: (u) => out.redirects.push(u) };
  return out;
};

test("(a) listActiveTypes: the null-active legacy type is absent", async () => {
  const names = (await listActiveTypes(memDb(SEED))).map((t) => t.exptype);
  assert.ok(!names.includes("Legacy Misc"), `null-active type leaked: ${names}`);
});
test("(a2) listActiveTypes: the active=false retired type is absent", async () => {
  const names = (await listActiveTypes(memDb(SEED))).map((t) => t.exptype);
  assert.ok(!names.includes("Old Courier"), `retired type leaked: ${names}`);
});
test("listActiveTypes: exactly the active=true types, ordered by name", async () => {
  assert.deepEqual((await listActiveTypes(memDb(SEED))).map((t) => t.exptype), ["Filing Fee", "Postage"]);
});

test("(b) retireType: flips active=false and the row still exists", async () => {
  const db = memDb(SEED);
  await retireType(db, 1);
  assert.deepEqual(db.tables.tblexptype.find((t) => t.exptypeid === 1), { exptypeid: 1, exptype: "Postage", active: false });
});
test("(b2) retireType: expenses keep their exptype, no DELETE, no call touches tblexpenses", async () => {
  const db = memDb(SEED);
  await retireType(db, 1);
  assert.deepEqual(db.tables.tblexpenses, SEED.tblexpenses);
  assert.ok(!db.calls.some((c) => c.op === "delete"), "a DELETE was issued");
  assert.ok(!db.calls.some((c) => c.table !== "tblexptype"), "a call touched another table");
});
test("retireType: unknown id → notfound, nothing changed", async () => {
  const db = memDb(SEED);
  await assert.rejects(retireType(db, 99), { code: "notfound" });
  assert.deepEqual(db.tables, SEED);
});
test("reactivateType: retired and legacy-null types come back active=true", async () => {
  const db = memDb(SEED);
  await reactivateType(db, 2);
  await reactivateType(db, 3);
  assert.deepEqual((await listActiveTypes(db)).map((t) => t.exptype), ["Filing Fee", "Legacy Misc", "Old Courier", "Postage"]);
});

test("(c) staff runAddType → ?error=forbidden and zero writes", async () => {
  const db = memDb(SEED);
  const d = deps(db, "staff");
  await runAddType(form({ name: "Sneaky" }), d.deps);
  assert.deepEqual({ redirects: d.redirects, writes: db.writes, table: db.tables.tblexptype }, { redirects: ["/expenses/types?error=forbidden"], writes: [], table: SEED.tblexptype });
});
test("(d) staff runRetireType → ?error=forbidden and zero writes", async () => {
  const db = memDb(SEED);
  const d = deps(db, "staff");
  await runRetireType(form({ id: "1" }), d.deps);
  assert.deepEqual({ redirects: d.redirects, writes: db.writes, table: db.tables.tblexptype }, { redirects: ["/expenses/types?error=forbidden"], writes: [], table: SEED.tblexptype });
});
test("staff runReactivateType → ?error=forbidden and zero writes", async () => {
  const db = memDb(SEED);
  const d = deps(db, "staff");
  await runReactivateType(form({ id: "2" }), d.deps);
  assert.deepEqual({ redirects: d.redirects, writes: db.writes }, { redirects: ["/expenses/types?error=forbidden"], writes: [] });
});

test("(e) admin runAddType inserts one active=true row", async () => {
  const db = memDb(SEED);
  const d = deps(db, "admin");
  await runAddType(form({ name: "  Court Reporter " }), d.deps);
  assert.deepEqual(db.tables.tblexptype.at(-1), { exptypeid: 5, exptype: "Court Reporter", active: true });
  assert.deepEqual(d.redirects, ["/expenses/types?saved=1"]);
});
test("admin runAddType: blank name → ?error=name, no write", async () => {
  const db = memDb(SEED);
  const d = deps(db, "admin");
  await runAddType(form({ name: "   " }), d.deps);
  assert.deepEqual({ redirects: d.redirects, writes: db.writes }, { redirects: ["/expenses/types?error=name"], writes: [] });
});
test("admin runRetireType / runReactivateType round-trip; bad id → notfound", async () => {
  const db = memDb(SEED);
  const d = deps(db, "admin");
  await runRetireType(form({ id: "4" }), d.deps);
  assert.equal(db.tables.tblexptype.find((t) => t.exptypeid === 4).active, false);
  await runReactivateType(form({ id: "4" }), d.deps);
  assert.equal(db.tables.tblexptype.find((t) => t.exptypeid === 4).active, true);
  await runRetireType(form({ id: "abc" }), d.deps);
  assert.deepEqual(d.redirects, ["/expenses/types?saved=1", "/expenses/types?saved=1", "/expenses/types?error=notfound"]);
});
