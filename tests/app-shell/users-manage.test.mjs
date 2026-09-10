/**
 * Unit checks for the item-6 guards in lib/auth/users.ts: an in-memory fake of the
 * slice of the Supabase query builder they use. No network.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { deactivateUser, setUserRole, setBillingPerson } from "../../lib/auth/users.ts";

/**
 * Fake db. `countErrorAt` = set of admin-count call numbers that error; `afterDelete` /
 * `afterUpdate` run right after the mutation (to simulate a concurrent removal).
 */
function fakeDb(rows, { billing = [], countErrorAt = new Set(), afterDelete, afterUpdate, insertError = null } = {}) {
  const tables = { profiles: rows.map((r) => ({ createdat: "t0", personid: null, ...r })), tblbillingnames: billing };
  const calls = { authDelete: 0, inserts: [], counts: 0, deletes: 0, updates: 0 };
  const db = {
    auth: { admin: { deleteUser: async () => (calls.authDelete++, { error: null }) } },
    from(table) {
      const filters = [];
      let op = "select", payload, countMode = false;
      const match = () => tables[table].filter((r) => filters.every(([k, v]) => r[k] === v));
      const run = async (shape) => {
        if (op === "select" && countMode) {
          const n = ++calls.counts;
          if (countErrorAt.has(n)) return { count: null, error: { message: "boom" } };
          return { count: match().length, error: null };
        }
        if (op === "select") {
          const hit = match();
          return shape === "single" ? { data: hit[0] ?? null, error: null } : { data: hit, error: null };
        }
        if (op === "delete") {
          calls.deletes++;
          const hit = match();
          tables[table] = tables[table].filter((r) => !hit.includes(r));
          afterDelete?.(tables);
          return { data: hit.map((r) => ({ id: r.id })), error: null };
        }
        if (op === "update") {
          calls.updates++;
          const hit = match();
          for (const r of hit) Object.assign(r, payload);
          afterUpdate?.(tables, payload);
          return { data: hit.map((r) => ({ id: r.id })), error: null };
        }
      };
      const q = {
        select(_c, opts) { if (opts?.count) countMode = true; return q; },
        eq(k, v) { filters.push([k, v]); return q; },
        delete() { op = "delete"; return q; },
        update(p) { op = "update"; payload = p; return q; },
        insert(row) {
          calls.inserts.push(row);
          if (!insertError) tables[table].push({ ...row });
          return Promise.resolve({ error: insertError ? { message: insertError } : null });
        },
        maybeSingle: () => run("single"),
        then: (res, rej) => run("many").then(res, rej),
      };
      return q;
    },
  };
  return { db, tables, calls };
}

const ids = (t) => t.profiles.map((r) => r.id).sort();

test("deactivate: self refused, row kept", async () => {
  const { db, tables, calls } = fakeDb([{ id: "a", role: "admin" }, { id: "b", role: "admin" }]);
  const r = await deactivateUser(db, "a", "a");
  assert.equal(r.ok, false);
  assert.match(r.error, /own account/);
  assert.deepEqual(ids(tables), ["a", "b"]);
  assert.equal(calls.deletes, 0);
});

test("deactivate: missing actor or target id refused", async () => {
  const { db, tables } = fakeDb([{ id: "a", role: "admin" }, { id: "b", role: "staff" }]);
  for (const [actor, target] of [[null, "b"], ["a", ""], [undefined, undefined]]) {
    assert.equal((await deactivateUser(db, actor, target)).ok, false);
  }
  assert.deepEqual(ids(tables), ["a", "b"]);
});

test("deactivate: exactly one admin → refused; promote second, then deactivating the first succeeds", async () => {
  const { db, tables, calls } = fakeDb([{ id: "a", role: "admin" }, { id: "b", role: "staff" }]);
  const r = await deactivateUser(db, "b", "a");
  assert.equal(r.ok, false);
  assert.match(r.error, /last remaining admin/);
  assert.deepEqual(ids(tables), ["a", "b"]);
  assert.equal(calls.deletes, 0, "pre-check did not stop the delete");

  assert.equal((await setUserRole(db, "b", "admin")).ok, true);
  const r2 = await deactivateUser(db, "b", "a");
  assert.equal(r2.ok, true, JSON.stringify(r2));
  assert.deepEqual(ids(tables), ["b"]);
  assert.equal(calls.authDelete, 0, "auth.users delete was called");
});

test("deactivate: admin count error → refused, row kept", async () => {
  const { db, tables } = fakeDb([{ id: "a", role: "admin" }, { id: "b", role: "admin" }], { countErrorAt: new Set([1]) });
  const r = await deactivateUser(db, "a", "b");
  assert.equal(r.ok, false);
  assert.match(r.error, /confirm another admin/, "refused for the wrong reason — null-count check not firing");
  assert.deepEqual(ids(tables), ["a", "b"]);
});

test("deactivate: race — post-delete recount is zero → row restored intact, refused", async () => {
  // Concurrent deactivation removes the other admin between our pre-check and our recount.
  const { db, tables, calls } = fakeDb([{ id: "a", role: "admin", email: "a@x", createdat: "t-a" }, { id: "b", role: "admin" }, { id: "s", role: "staff" }], {
    afterDelete: (t) => { t.profiles = t.profiles.filter((r) => r.id !== "a"); },
  });
  const r = await deactivateUser(db, "s", "b");
  assert.equal(r.ok, false);
  assert.deepEqual(calls.inserts.map((x) => x.id), ["b"], "deleted row not re-inserted");
  assert.ok(tables.profiles.some((x) => x.id === "b" && x.role === "admin"));
  assert.equal(calls.authDelete, 0);
});

test("deactivate: post-delete recount errors → row restored, refused", async () => {
  const { db, tables } = fakeDb([{ id: "a", role: "admin" }, { id: "b", role: "admin" }], { countErrorAt: new Set([2]) });
  const r = await deactivateUser(db, "a", "b");
  assert.equal(r.ok, false);
  assert.deepEqual(ids(tables), ["a", "b"]);
});

test("deactivate: staff target skips admin guard and never touches auth.users", async () => {
  const { db, tables, calls } = fakeDb([{ id: "a", role: "admin" }, { id: "s", role: "staff" }]);
  assert.equal((await deactivateUser(db, "a", "s")).ok, true);
  assert.deepEqual(ids(tables), ["a"]);
  assert.equal(calls.authDelete, 0);
});

test("role: only admin|staff accepted", async () => {
  const { db, tables } = fakeDb([{ id: "a", role: "admin" }, { id: "b", role: "staff" }]);
  for (const bad of ["Admin", "owner", "", null, "admin "]) assert.equal((await setUserRole(db, "b", bad)).ok, false);
  assert.equal(tables.profiles.find((r) => r.id === "b").role, "staff");
});

test("role: demoting the last admin refused; count error refused", async () => {
  const one = fakeDb([{ id: "a", role: "admin" }, { id: "b", role: "staff" }]);
  assert.equal((await setUserRole(one.db, "a", "staff")).ok, false);
  assert.equal(one.tables.profiles.find((r) => r.id === "a").role, "admin");
  assert.equal(one.calls.updates, 0, "pre-check did not stop the update");

  const err = fakeDb([{ id: "a", role: "admin" }, { id: "b", role: "admin" }], { countErrorAt: new Set([1]) });
  const e = await setUserRole(err.db, "a", "staff");
  assert.equal(e.ok, false);
  assert.match(e.error, /confirm another admin/);
  assert.equal(err.tables.profiles.find((r) => r.id === "a").role, "admin");
});

test("role: race — concurrent demotion leaves zero admins → reverted, refused", async () => {
  const { db, tables } = fakeDb([{ id: "a", role: "admin" }, { id: "b", role: "admin" }], {
    afterUpdate: (t, p) => { if (p.role === "staff") t.profiles.find((r) => r.id === "a").role = "staff"; },
  });
  assert.equal((await setUserRole(db, "b", "staff")).ok, false);
  assert.equal(tables.profiles.find((r) => r.id === "b").role, "admin");
});

test("billing person: valid personid written, empty → null, unknown/garbage refused", async () => {
  const { db, tables } = fakeDb([{ id: "a", role: "admin", personid: null }], { billing: [{ personid: 7, initials: "JD" }] });
  const row = () => tables.profiles.find((r) => r.id === "a");
  assert.equal((await setBillingPerson(db, "a", "7")).ok, true);
  assert.equal(row().personid, 7);
  for (const bad of ["8", "7; drop", "-1", "1e3"]) assert.equal((await setBillingPerson(db, "a", bad)).ok, false, bad);
  assert.equal(row().personid, 7);
  assert.equal((await setBillingPerson(db, "a", "")).ok, true);
  assert.equal(row().personid, null);
});

// ---------------------------------------------------------------------------
// QA additions (item 6): real interleaving, partial state, action auth wiring.
// ---------------------------------------------------------------------------
import { readFileSync } from "node:fs";

test("qa: two concurrent deactivations of the last two admins leave ≥1 admin, auth untouched", async () => {
  const { db, tables, calls } = fakeDb([{ id: "a", role: "admin" }, { id: "b", role: "admin" }]);
  const [r1, r2] = await Promise.all([deactivateUser(db, "a", "b"), deactivateUser(db, "b", "a")]);
  const admins = tables.profiles.filter((r) => r.role === "admin").length;
  assert.ok(admins >= 1, `0 admins left: ${JSON.stringify([r1, r2])}`);
  assert.ok(!(r1.ok && r2.ok), "both deactivations reported success");
  assert.equal(calls.authDelete, 0);
});

test("qa: two concurrent demotions of the last two admins leave ≥1 admin", async () => {
  const { db, tables } = fakeDb([{ id: "a", role: "admin" }, { id: "b", role: "admin" }]);
  await Promise.all([setUserRole(db, "a", "staff"), setUserRole(db, "b", "staff")]);
  assert.ok(tables.profiles.some((r) => r.role === "admin"), "both demoted");
});

test("qa: failed restore after a zero recount is refused loudly, never reported ok", async () => {
  const { db } = fakeDb([{ id: "a", role: "admin" }, { id: "b", role: "admin" }, { id: "s", role: "staff" }], {
    afterDelete: (t) => { t.profiles = t.profiles.filter((r) => r.id !== "a"); },
    insertError: "restore failed",
  });
  const r = await deactivateUser(db, "s", "b");
  assert.equal(r.ok, false);
  assert.match(r.error, /contact support/);
});

test("qa: self-deactivation refused before any DB read", async () => {
  const db = { from() { throw new Error("db touched"); }, auth: { admin: { deleteUser() { throw new Error("auth touched"); } } } };
  const r = await deactivateUser(db, "a", "a");
  assert.equal(r.ok, false);
  assert.match(r.error, /own account/);
});

test("qa: every item-6 server action calls requireSession('admin') as its first statement", () => {
  const src = readFileSync(new URL("../../app/(auth)/users/actions.ts", import.meta.url), "utf8");
  for (const name of ["setRoleAction", "setBillingPersonAction", "deactivateAction"]) {
    const body = src.split(`export async function ${name}(`)[1]?.split("\n}")[0] ?? "";
    const first = body.split("{").slice(1).join("{").trim().split("\n")[0];
    assert.match(first, /await requireSession\("admin"\);$/, `${name} first statement: ${first}`);
  }
});
