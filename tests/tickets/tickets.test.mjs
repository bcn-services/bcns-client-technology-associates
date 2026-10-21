// Unit tests for lib/tickets.ts with an in-memory fake PostgREST client that really evaluates filters.
import { test } from "node:test";
import assert from "node:assert/strict";
import { listTickets, parseSort, setStatus, runAddTicket, runCloseTicket, runReopenTicket } from "../../lib/tickets.ts";

/** In-memory fake: eq evaluated against `tables`; every op recorded in `calls`, writes in `writes`. */
function memDb(seed) {
  const tables = structuredClone(seed);
  const calls = [];
  const writes = [];
  return {
    tables, calls, writes,
    from(table) {
      const st = { table, op: "select", filters: [], payload: null };
      calls.push(st);
      const exec = () => {
        const rows = (tables[table] ??= []);
        const match = (r) => st.filters.every(([c, v]) => r[c] === v);
        if (st.op === "insert") {
          const id = Math.max(0, ...rows.map((r) => r.id ?? 0)) + 1;
          const row = { id, status: "Open", createdat: "now", ...st.payload };
          rows.push(row); writes.push(["insert", table, row]);
          return { data: [row], error: null };
        }
        if (st.op === "update") {
          const hit = rows.filter(match);
          for (const r of hit) Object.assign(r, st.payload);
          writes.push(["update", table, st.payload, hit.length]);
          return { data: hit.map((r) => ({ ...r })), error: null };
        }
        return { data: rows.filter(match).map((r) => ({ ...r })), error: null };
      };
      const b = {
        select() { return b; },
        insert(p) { st.op = "insert"; st.payload = p; return b; },
        update(p) { st.op = "update"; st.payload = p; return b; },
        eq(c, v) { st.filters.push([c, v]); return b; },
        then(res, rej) { return Promise.resolve().then(exec).then(res, rej); },
      };
      return b;
    },
  };
}

const T = (id, ticketdate, status, description = `t${id}`) => ({ id, ticketdate, description, status, createdat: "x" });
const SEED = {
  tickets: [
    T(1, "2026-10-01", "Closed"),
    T(2, "2026-10-05", "Open"),
    T(3, "2026-10-09", "Closed"),
    T(4, "2026-10-05", "Open"), // same date as 2: newest id first
    T(5, "2026-09-30", "Open"),
  ],
};
const ids = async (dir) => (await listTickets(memDb(SEED), dir)).map((t) => t.id);
const form = (o) => { const f = new FormData(); for (const [k, v] of Object.entries(o)) f.set(k, v); return f; };
const deps = (db, session = async () => ({ userId: "u", email: "e", role: "staff", personId: null })) => {
  const out = { redirects: [], paths: [] };
  out.deps = { session, db: () => db, revalidatePath: (p) => out.paths.push(p), redirect: (u) => out.redirects.push(u) };
  return out;
};

test("parseSort: only sort=status with dir asc|desc passes; everything else is the default (null)", () => {
  assert.equal(parseSort("status", "asc"), "asc");
  assert.equal(parseSort("status", "desc"), "desc");
  for (const [s, d] of [["", ""], ["status", ""], ["status", "up"], ["description", "asc"], ["status", "ASC"], ["status; drop", "asc"], ["", "asc"]]) {
    assert.equal(parseSort(s, d), null, `${s}/${d}`);
  }
});

test("default order: Open first, then newest date, then newest id", async () => {
  assert.deepEqual(await ids(null), [4, 2, 5, 3, 1]);
});
test("status asc is the default order", async () => {
  assert.deepEqual(await ids("asc"), await ids(null));
});
test("status desc: Closed first, same date/id tiebreaks", async () => {
  assert.deepEqual(await ids("desc"), [3, 1, 4, 2, 5]);
});

test("setStatus: flips one row, others untouched; unknown id → notfound, no change", async () => {
  const db = memDb(SEED);
  await setStatus(db, 2, "Closed");
  assert.deepEqual(db.tables.tickets.map((t) => t.status), ["Closed", "Closed", "Closed", "Open", "Open"]);
  const db2 = memDb(SEED);
  await assert.rejects(setStatus(db2, 99, "Closed"), { code: "notfound" });
  assert.deepEqual(db2.tables, SEED);
});

test("runAddTicket: trims, inserts one Open row, redirects to /tickets and revalidates", async () => {
  const db = memDb(SEED);
  const d = deps(db);
  await runAddTicket(form({ date: "2026-10-21", description: "  Add a print button  " }), d.deps);
  assert.deepEqual(db.writes, [["insert", "tickets", { id: 6, status: "Open", createdat: "now", ticketdate: "2026-10-21", description: "Add a print button" }]]);
  assert.deepEqual({ redirects: d.redirects, paths: d.paths }, { redirects: ["/tickets"], paths: ["/tickets"] });
});
test("runAddTicket: blank / whitespace / missing / over-long description → ?error=description, zero writes", async () => {
  for (const description of ["", "   \n ", "x".repeat(2001), undefined]) {
    const db = memDb(SEED);
    const d = deps(db);
    await runAddTicket(form({ date: "2026-10-21", ...(description === undefined ? {} : { description }) }), d.deps);
    assert.deepEqual({ r: d.redirects, w: db.writes }, { r: ["/tickets?error=description"], w: [] });
  }
});
test("runAddTicket: malformed or impossible date → ?error=date, zero writes", async () => {
  for (const date of ["", "10/21/2026", "2026-13-01", "2026-02-30", "2026-1-5", "yesterday"]) {
    const db = memDb(SEED);
    const d = deps(db);
    await runAddTicket(form({ date, description: "ok" }), d.deps);
    assert.deepEqual({ r: d.redirects, w: db.writes }, { r: ["/tickets?error=date"], w: [] }, date);
  }
});

test("runClose/runReopen: flip status; bad or unknown id → ?error=notfound, zero writes", async () => {
  const db = memDb(SEED);
  const d = deps(db);
  await runCloseTicket(form({ id: "2" }), d.deps);
  assert.equal(db.tables.tickets.find((t) => t.id === 2).status, "Closed");
  await runReopenTicket(form({ id: "2" }), d.deps);
  assert.equal(db.tables.tickets.find((t) => t.id === 2).status, "Open");
  const before = db.writes.length;
  await runCloseTicket(form({ id: "abc" }), d.deps);
  await runCloseTicket(form({ id: "-1" }), d.deps);
  await runCloseTicket(form({ id: "99" }), d.deps);
  assert.deepEqual(d.redirects, ["/tickets", "/tickets", "/tickets?error=notfound", "/tickets?error=notfound", "/tickets?error=notfound"]);
  assert.equal(db.writes.length, before + 1); // only the id=99 update ran (matched nothing)
});

test("both roles may act (admin and staff alike)", async () => {
  for (const role of ["admin", "staff"]) {
    const db = memDb(SEED);
    const d = deps(db, async () => ({ userId: "u", email: "e", role, personId: null }));
    await runAddTicket(form({ date: "2026-10-21", description: role }), d.deps);
    assert.deepEqual(d.redirects, ["/tickets"], role);
  }
});

test("no session: the redirect error propagates and nothing is read or written", async () => {
  const db = memDb(SEED);
  const d = deps(db, async () => { throw Object.assign(new Error("NEXT_REDIRECT"), { digest: "NEXT_REDIRECT;replace;/login;307;" }); });
  await assert.rejects(runAddTicket(form({ date: "2026-10-21", description: "x" }), d.deps), /NEXT_REDIRECT/);
  assert.deepEqual({ calls: db.calls.length, redirects: d.redirects }, { calls: 0, redirects: [] });
});

test("unexpected DB error → ?error=failed (raw text stays server-side)", async () => {
  const d = deps({ from: () => { throw new Error("pg: secret detail"); } });
  const log = console.error; console.error = () => {};
  try { await runCloseTicket(form({ id: "1" }), d.deps); } finally { console.error = log; }
  assert.deepEqual(d.redirects, ["/tickets?error=failed"]);
});
