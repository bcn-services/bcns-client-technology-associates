// Unit tests for lib/tickets.ts with an in-memory fake PostgREST client (./fakedb.mjs) that really evaluates filters.
import { test } from "node:test";
import assert from "node:assert/strict";
import { listTickets, parseSort, setStatus, runAddTicket, runCloseTicket, runReopenTicket, runEditTicket } from "../../lib/tickets.ts";
import { memDb } from "./fakedb.mjs";

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
test("In review sorts before Open before Closed; desc reverses the groups; messages ride along oldest first", async () => {
  const seed = {
    tickets: [T(1, "2026-10-01", "Closed"), T(2, "2026-10-05", "Open"), T(3, "2026-09-01", "In review"), T(4, "2026-10-09", "Open")],
    ticket_messages: [
      { id: 2, ticketid: 3, author: "email", body: "second", createdat: "2026-10-21T00:00:02Z" },
      { id: 1, ticketid: 3, author: "a@x.test", body: "first", createdat: "2026-10-21T00:00:01Z" },
    ],
  };
  const asc = await listTickets(memDb(seed), null);
  assert.deepEqual(asc.map((t) => t.id), [3, 4, 2, 1]);
  assert.deepEqual(asc[0].messages.map((m) => m.body), ["first", "second"]);
  assert.deepEqual(asc[1].messages, []);
  assert.deepEqual((await listTickets(memDb(seed), "desc")).map((t) => t.id), [1, 4, 2, 3]);
  const db = memDb(seed);
  await listTickets(db, null);
  assert.equal(db.calls.filter((c) => c.table === "ticket_messages").length, 1, "one messages query, not one per ticket");
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
  assert.equal(db.writes.length, 1);
  assert.deepEqual(db.writes[0].slice(0, 2), ["insert", "tickets"]);
  assert.deepEqual(db.writes[0][2], { id: 6, status: "Open", createdat: "2026-10-21T00:00:06Z", ticketdate: "2026-10-21", description: "Add a print button" });
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
  assert.equal(db.writes.length, before);
});

const withReview = () => memDb({ tickets: [T(1, "2026-10-01", "Open", "one"), T(2, "2026-10-02", "In review", "two"), T(3, "2026-10-03", "Closed", "three")] });
const statusOf = (db, id) => db.tables.tickets.find((t) => t.id === id).status;

test("transitions: Close from Open or In review, Reopen from In review or Closed; anything else → ?error=state, zero writes", async () => {
  const db = withReview();
  const d = deps(db);
  await runCloseTicket(form({ id: "1" }), d.deps);
  await runCloseTicket(form({ id: "2" }), d.deps);
  assert.deepEqual([1, 2].map((i) => statusOf(db, i)), ["Closed", "Closed"]);
  await runReopenTicket(form({ id: "3" }), d.deps);
  assert.equal(statusOf(db, 3), "Open");
  const review = memDb({ tickets: [T(5, "2026-10-01", "In review")] });
  await runReopenTicket(form({ id: "5" }), deps(review).deps);
  assert.equal(statusOf(review, 5), "Open");
  assert.deepEqual(d.redirects, ["/tickets", "/tickets", "/tickets"]);

  const bad = withReview();
  const e = deps(bad);
  await runCloseTicket(form({ id: "3", response: "x" }), e.deps); // already Closed
  await runReopenTicket(form({ id: "1", response: "x" }), e.deps); // Open
  assert.deepEqual(e.redirects, ["/tickets?error=state", "/tickets?error=state"]);
  assert.deepEqual(bad.writes, []);
});

test("response: trimmed, stored as a message by the signed-in user; blank stores none; over 2000 → ?error=response, zero writes", async () => {
  const db = withReview();
  const d = deps(db, async () => ({ userId: "u", email: "kris@x.test", role: "staff", personId: null }));
  await runReopenTicket(form({ id: "2", response: "  Fixed in the new build  " }), d.deps);
  assert.deepEqual(db.tables.ticket_messages.map(({ ticketid, author, body }) => ({ ticketid, author, body })), [{ ticketid: 2, author: "kris@x.test", body: "Fixed in the new build" }]);
  assert.equal(statusOf(db, 2), "Open");
  await runCloseTicket(form({ id: "2", response: "   " }), d.deps);
  assert.equal(db.tables.ticket_messages.length, 1);
  const long = withReview();
  const e = deps(long);
  await runCloseTicket(form({ id: "1", response: "x".repeat(2001) }), e.deps);
  assert.deepEqual({ r: e.redirects, w: long.writes }, { r: ["/tickets?error=response"], w: [] });
});

test("runEditTicket: updates the description of Open and In review tickets; Closed → ?error=state; blank/long → ?error=description; unknown → notfound", async () => {
  const db = withReview();
  const d = deps(db);
  await runEditTicket(form({ id: "1", description: "  better words " }), d.deps);
  await runEditTicket(form({ id: "2", description: "also better" }), d.deps);
  assert.deepEqual([1, 2].map((i) => db.tables.tickets.find((t) => t.id === i).description), ["better words", "also better"]);
  assert.deepEqual([1, 2].map((i) => statusOf(db, i)), ["Open", "In review"], "edit never changes status");
  const before = db.writes.length;
  await runEditTicket(form({ id: "3", description: "nope" }), d.deps);
  await runEditTicket(form({ id: "1", description: "   " }), d.deps);
  await runEditTicket(form({ id: "1", description: "x".repeat(2001) }), d.deps);
  await runEditTicket(form({ id: "99", description: "ok" }), d.deps);
  assert.deepEqual(d.redirects.slice(2), ["/tickets?error=state", "/tickets?error=description", "/tickets?error=description", "/tickets?error=notfound"]);
  assert.equal(db.writes.length, before);
  assert.equal(db.tables.tickets.find((t) => t.id === 3).description, "three");
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

// Race guards: another actor changes the ticket between our load and our write (the 2nd touch of `tickets`).
const racing = (db, mutate) => {
  const from = db.from.bind(db);
  let n = 0;
  db.from = (table) => { if (table === "tickets" && ++n === 2) mutate(db.tables.tickets[0]); return from(table); };
  return db;
};

test("race: Close/Reopen lose to a status change between load and write → ?error=state, status stays the racer's, the response is taken back, no email", async () => {
  for (const [run, start, racer] of [[runCloseTicket, "Open", "Closed"], [runReopenTicket, "Closed", "Open"]]) {
    const db = racing(memDb({ tickets: [T(1, "2026-10-01", start, "one")] }), (t) => { t.status = racer; });
    const d = deps(db);
    const sent = [];
    await run(form({ id: "1", response: "late response" }), { ...d.deps, notify: async (m) => sent.push(m) });
    assert.deepEqual(d.redirects, ["/tickets?error=state"], start);
    assert.equal(statusOf(db, 1), racer, `${start}: the racer's status stands`);
    assert.deepEqual(db.tables.ticket_messages ?? [], [], `${start}: the unapplied response is not left behind`);
    assert.deepEqual(sent, [], `${start}: nothing emailed`);
  }
});

test("race: Edit loses to a Close between load and write → ?error=state, description unchanged", async () => {
  const db = racing(memDb({ tickets: [T(1, "2026-10-01", "Open", "original")] }), (t) => { t.status = "Closed"; });
  const d = deps(db);
  await runEditTicket(form({ id: "1", description: "overwrites a closed ticket" }), d.deps);
  assert.deepEqual(d.redirects, ["/tickets?error=state"]);
  assert.deepEqual({ description: db.tables.tickets[0].description, status: statusOf(db, 1) }, { description: "original", status: "Closed" });
});

test("listTickets pages messages past PostgREST's 1000-row cap (Closed rows keep their history)", async () => {
  const messages = Array.from({ length: 2300 }, (_, i) => ({ id: i + 1, ticketid: i % 2 ? 1 : 2, author: "a", body: `m${i}`, createdat: `2026-10-21T00:00:00.${String(i).padStart(4, "0")}Z` }));
  const db = memDb({ tickets: [T(1, "2026-10-01", "Closed"), T(2, "2026-10-02", "Open")], ticket_messages: messages });
  const got = await listTickets(db, null);
  assert.deepEqual(got.map((t) => t.messages.length).sort(), [1150, 1150]);
  assert.equal(db.calls.filter((c) => c.table === "ticket_messages").length, 3);
});
