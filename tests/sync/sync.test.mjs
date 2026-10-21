/**
 * Unit checks for lib/sync/runs.ts and the /sync server action: an in-memory fake of the slice
 * of the Supabase query builder it uses, plus a fake fetch. No network, no database.
 * The fake does NOT enforce the one-active-run unique index (that is the DB's job, pinned in
 * tests/foundation/sync-runs.test.mjs) so a skipped app-level check shows up here as an insert.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { requestSync, syncState, STALE_MS, STALE_QUEUED_MS, DISPATCH_URL } from "../../lib/sync/runs.ts";

const NOW = Date.parse("2026-10-21T12:00:00Z");
const HOUR = 3600 * 1000;
const TOKEN = "ghp_secret_token_value";
const ago = (ms) => new Date(NOW - ms).toISOString();
const run = (over) => ({ id: 1, status: "succeeded", requested_by: "u0", requested_at: ago(10 * HOUR), started_at: null, finished_at: null, backup_key: null, backup_at: null, run_url: null, error: null, ...over });

// readAs: what select returns instead of the table (a snapshot taken before another writer finished the row)
function fakeDb(rows, { insertError = null, readAs = null } = {}) {
  const table = rows.map((r) => ({ ...r }));
  const calls = { inserts: [], updates: [] };
  const db = {
    from(name) {
      assert.equal(name, "sync_runs");
      let op = "select", payload, filter, statusIn;
      const q = {
        select() { return q; },
        order() { return q; },
        limit() { return q; },
        eq(k, v) { filter = [k, v]; return q; },
        in(k, vals) { assert.equal(k, "status"); statusIn = vals; return q; },
        insert(row) { op = "insert"; payload = row; return q; },
        update(p) { op = "update"; payload = p; return q; },
        single: async () => {
          if (insertError) return { data: null, error: insertError };
          const row = run({ id: Math.max(0, ...table.map((r) => r.id)) + 1, status: "queued", requested_at: new Date(NOW).toISOString(), ...payload });
          calls.inserts.push(payload);
          table.push(row);
          return { data: row, error: null };
        },
        then(resolve, reject) {
          return (async () => {
            if (op === "update") {
              calls.updates.push({ filter, statusIn, ...payload });
              for (const r of table.filter((r) => r[filter[0]] === filter[1] && (!statusIn || statusIn.includes(r.status)))) Object.assign(r, payload);
              return { data: null, error: null };
            }
            return { data: readAs ?? [...table].sort((a, b) => b.id - a.id).slice(0, 1), error: null };
          })().then(resolve, reject);
        },
      };
      return q;
    },
  };
  return { db, table, calls };
}

function fakeFetch(status = 204) {
  const sent = [];
  const f = async (url, init) => {
    sent.push({ url, init });
    if (status === "throw") throw new Error(`boom ${TOKEN}`);
    return { status };
  };
  return { f, sent };
}

test("the stale window and dispatch target are pinned to literals", () => {
  assert.equal(STALE_MS, 3 * 60 * 60 * 1000);
  assert.equal(STALE_QUEUED_MS, 30 * 60 * 1000);
  assert.equal(DISPATCH_URL, "https://api.github.com/repos/bcn-services/bcns-client-technology-associates/actions/workflows/sync-legacy.yml/dispatches");
});

test("1: the sync server action checks for an admin as its first statement (staff are forbidden)", () => {
  const src = readFileSync(new URL("../../app/(auth)/sync/actions.ts", import.meta.url), "utf8");
  const body = src.split("export async function syncAction(")[1]?.split("\n}")[0] ?? "";
  const first = body.split("{").slice(1).join("{").trim().split("\n")[0];
  assert.match(first, /^if \(!\(await requireSession\("admin"\)\.catch\(onlyForbidden\)\)\) return /, `first statement: ${first}`);
});

test("2: a fresh queued or running row refuses the request and never calls fetch", async () => {
  for (const status of ["queued", "running"]) {
    const { db, calls } = fakeDb([run({ id: 5, status, requested_at: ago(10 * 60 * 1000), started_at: status === "running" ? ago(1 * HOUR) : null })]);
    const { f, sent } = fakeFetch();
    const r = await requestSync(db, "admin-1", TOKEN, f, NOW);
    assert.equal(r.ok, false, status);
    assert.match(r.error, /already running/, status);
    assert.equal(sent.length, 0, status);
    assert.equal(calls.inserts.length, 0, status);
    assert.equal(calls.updates.length, 0, status);
  }
});

test("3: a running row started >3h ago is marked failed 'timed out' and a new run proceeds", async () => {
  const { db, table, calls } = fakeDb([run({ id: 5, status: "running", requested_at: ago(4 * HOUR), started_at: ago(3 * HOUR + 1000) })]);
  const { f, sent } = fakeFetch();
  const r = await requestSync(db, "admin-1", TOKEN, f, NOW);
  assert.equal(r.ok, true);
  const old = table.find((x) => x.id === 5);
  assert.equal(old.status, "failed");
  assert.equal(old.error, "timed out");
  assert.ok(old.finished_at);
  assert.deepEqual(calls.inserts, [{ requested_by: "admin-1" }]);
  assert.deepEqual(calls.updates[0].statusIn, ["queued", "running"]);
  assert.equal(sent.length, 1);
  assert.equal(JSON.parse(sent[0].init.body).inputs.run_id, "6");
  // just inside the window still blocks, however long ago it was requested
  const fresh = fakeDb([run({ id: 5, status: "running", requested_at: ago(10 * HOUR), started_at: ago(3 * HOUR - 1000) })]);
  assert.equal((await requestSync(fresh.db, "admin-1", TOKEN, fakeFetch().f, NOW)).ok, false);
});

test("3b: a queued row that never started is stale after 30 min, not before", async () => {
  const stale = fakeDb([run({ id: 5, status: "queued", requested_at: ago(STALE_QUEUED_MS + 1000) })]);
  assert.equal((await requestSync(stale.db, "admin-1", TOKEN, fakeFetch().f, NOW)).ok, true);
  assert.equal(stale.table.find((x) => x.id === 5).error, "timed out");
  const fresh = fakeDb([run({ id: 5, status: "queued", requested_at: ago(STALE_QUEUED_MS - 1000) })]);
  assert.equal((await requestSync(fresh.db, "admin-1", TOKEN, fakeFetch().f, NOW)).ok, false);
});

test("3c: reclaiming never overwrites a run that finished since we read it", async () => {
  const snapshot = run({ id: 5, status: "running", requested_at: ago(6 * HOUR), started_at: ago(4 * HOUR) });
  const { db, table } = fakeDb([run({ id: 5, status: "succeeded", error: null, requested_at: ago(6 * HOUR), started_at: ago(4 * HOUR) })], { readAs: [snapshot] });
  await requestSync(db, "admin-1", TOKEN, fakeFetch().f, NOW);
  const old = table.find((x) => x.id === 5);
  assert.equal(old.status, "succeeded");
  assert.equal(old.error, null);
});

test("4: token unset -> canSync false 'Not configured'; requestSync refuses without inserting", async () => {
  const { db, calls } = fakeDb([run()]);
  for (const token of [undefined, ""]) {
    const s = await syncState(db, token, NOW);
    assert.equal(s.canSync, false);
    assert.equal(s.reason, "Not configured");
    const { f, sent } = fakeFetch();
    const r = await requestSync(db, "admin-1", token, f, NOW);
    assert.deepEqual(r, { ok: false, error: "Not configured" });
    assert.equal(sent.length, 0);
  }
  assert.equal(calls.inserts.length, 0);
});

test("4b: syncState reports the last run, an active run blocks, a stale or finished one does not", async () => {
  const idle = await syncState(fakeDb([run({ id: 2 })]).db, TOKEN, NOW);
  assert.deepEqual([idle.canSync, idle.active, idle.reason, idle.last.id], [true, false, undefined, 2]);
  const busy = await syncState(fakeDb([run({ id: 3, status: "running", requested_at: ago(5 * HOUR), started_at: ago(HOUR) })]).db, TOKEN, NOW);
  assert.deepEqual([busy.canSync, busy.active, busy.reason], [false, true, "A sync is running"]);
  const stale = await syncState(fakeDb([run({ id: 3, status: "queued", requested_at: ago(4 * HOUR) })]).db, TOKEN, NOW);
  assert.deepEqual([stale.canSync, stale.active], [true, false]);
  const staleRunning = await syncState(fakeDb([run({ id: 3, status: "running", requested_at: ago(5 * HOUR), started_at: ago(4 * HOUR) })]).db, TOKEN, NOW);
  assert.deepEqual([staleRunning.canSync, staleRunning.active], [true, false]);
  const none = await syncState(fakeDb([]).db, TOKEN, NOW);
  assert.deepEqual([none.last, none.canSync], [null, true]);
});

test("happy path: queued row inserted, one POST with the exact GitHub contract", async () => {
  const { db, table } = fakeDb([run({ id: 1 })]);
  const { f, sent } = fakeFetch(204);
  const r = await requestSync(db, "admin-1", TOKEN, f, NOW);
  assert.equal(r.ok, true);
  assert.equal(table.at(-1).status, "queued");
  assert.equal(table.at(-1).requested_by, "admin-1");
  assert.equal(sent.length, 1);
  assert.equal(sent[0].url, "https://api.github.com/repos/bcn-services/bcns-client-technology-associates/actions/workflows/sync-legacy.yml/dispatches");
  assert.equal(sent[0].init.method, "POST");
  assert.deepEqual(sent[0].init.headers, { Authorization: `Bearer ${TOKEN}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" });
  assert.deepEqual(JSON.parse(sent[0].init.body), { ref: "main", inputs: { run_id: "2" } });
});

test("5: a non-204 dispatch (or a thrown fetch) marks the row failed, with no token anywhere", async () => {
  for (const [status, error] of [[403, "dispatch failed (HTTP 403)"], [200, "dispatch failed (HTTP 200)"], ["throw", "dispatch failed (network error)"]]) {
    const { db, table } = fakeDb([run({ id: 1 })]);
    const r = await requestSync(db, "admin-1", TOKEN, fakeFetch(status).f, NOW);
    assert.equal(r.ok, false, String(status));
    const row = table.at(-1);
    assert.equal(row.status, "failed", String(status));
    assert.equal(row.error, error);
    assert.ok(row.finished_at);
    assert.ok(!JSON.stringify([r, row]).includes(TOKEN), "token leaked");
  }
});

test("6: a 23505 on insert (lost the race) reports 'already running' and dispatches nothing", async () => {
  const { db } = fakeDb([run()], { insertError: { code: "23505", message: "duplicate key value violates unique constraint" } });
  const { f, sent } = fakeFetch();
  const r = await requestSync(db, "admin-1", TOKEN, f, NOW);
  assert.equal(r.ok, false);
  assert.match(r.error, /already running/);
  assert.equal(sent.length, 0);
  // any other insert error is a generic refusal, not "already running"
  const other = fakeDb([run()], { insertError: { code: "XX000", message: "x" } });
  assert.doesNotMatch((await requestSync(other.db, "admin-1", TOKEN, f, NOW)).error, /already running/);
});
