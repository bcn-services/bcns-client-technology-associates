// Unit tests for lib/time/entries.ts updateEntry / deleteEntry / loadEntry with a fake PostgREST
// client that records each chain separately (pattern: tests/cases/create.test.mjs).
// The refusal must live in the write statement's own filter chain, so each filter gets its own test.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { updateEntry, deleteEntry, loadEntry, TimeInputError, errorMessage } from "../../lib/time/entries.ts";

/** Each from() starts a new recorded chain; `respond(chain)` decides what it resolves to. */
function fakeDb(respond) {
  const chains = [];
  return {
    chains,
    from(t) {
      const chain = [["from", t]];
      chains.push(chain);
      const b = new Proxy({}, {
        get(_, k) {
          if (k === "then") return (res, rej) => Promise.resolve(respond(chain)).then(res, rej);
          return (...args) => { chain.push([k, ...args]); return b; };
        },
      });
      return b;
    },
  };
}
const has = (chain, m) => chain.some((c) => c[0] === m);
/** Writes succeed with one row; case lookups find the case. */
const okDb = (writeRows = [{ actid: 5, actdate: "2026-09-10", actwho: 2 }]) => fakeDb((chain) =>
  chain[0][1] === "tblcase" ? { data: { caseid: 90001 }, error: null } : { data: writeRows, error: null });
const writes = (db, m) => db.chains.filter((c) => has(c, m));
const payload = (db) => writes(db, "update")[0]?.find((c) => c[0] === "update")[1];
const filters = (chain) => chain.filter((c) => c[0] === "eq" || c[0] === "is").map((c) => c.slice(0, 3));

const STAFF = { personId: 1, role: "staff" };
const ADMIN = { personId: 2, role: "admin" };
const ORIG = { caseId: "90001", date: "2026-09-10", hours: "2", description: "Old" };
const EDIT = { ...ORIG, hours: "2.125", description: "New", orig: ORIG };
const refused = (code) => (e) => e instanceof TimeInputError && e.code === code;

// --- filters on the UPDATE chain ---
test("update chain filters eq actid", async () => {
  const db = okDb();
  await updateEntry(db, STAFF, 5, EDIT);
  assert.ok(filters(writes(db, "update")[0]).some((f) => f[0] === "eq" && f[1] === "actid" && f[2] === 5));
});
test("update chain filters eq actbilled false", async () => {
  const db = okDb();
  await updateEntry(db, STAFF, 5, EDIT);
  assert.ok(filters(writes(db, "update")[0]).some((f) => f[0] === "eq" && f[1] === "actbilled" && f[2] === false));
});
test("update chain filters is actbillid null", async () => {
  const db = okDb();
  await updateEntry(db, STAFF, 5, EDIT);
  assert.ok(filters(writes(db, "update")[0]).some((f) => f[0] === "is" && f[1] === "actbillid" && f[2] === null));
});
test("update chain filters eq actwho <personId> for staff", async () => {
  const db = okDb();
  await updateEntry(db, STAFF, 5, EDIT);
  assert.ok(filters(writes(db, "update")[0]).some((f) => f[0] === "eq" && f[1] === "actwho" && f[2] === 1));
});
test("update chain has no actwho filter for admin", async () => {
  const db = okDb();
  await updateEntry(db, ADMIN, 5, EDIT);
  assert.ok(!filters(writes(db, "update")[0]).some((f) => f[1] === "actwho"));
});

// --- filters on the DELETE chain ---
test("delete chain filters eq actid", async () => {
  const db = okDb();
  await deleteEntry(db, STAFF, 5);
  assert.ok(filters(writes(db, "delete")[0]).some((f) => f[0] === "eq" && f[1] === "actid" && f[2] === 5));
});
test("delete chain filters eq actbilled false", async () => {
  const db = okDb();
  await deleteEntry(db, STAFF, 5);
  assert.ok(filters(writes(db, "delete")[0]).some((f) => f[0] === "eq" && f[1] === "actbilled" && f[2] === false));
});
test("delete chain filters is actbillid null", async () => {
  const db = okDb();
  await deleteEntry(db, STAFF, 5);
  assert.ok(filters(writes(db, "delete")[0]).some((f) => f[0] === "is" && f[1] === "actbillid" && f[2] === null));
});
test("delete chain filters eq actwho <personId> for staff", async () => {
  const db = okDb();
  await deleteEntry(db, STAFF, 5);
  assert.ok(filters(writes(db, "delete")[0]).some((f) => f[0] === "eq" && f[1] === "actwho" && f[2] === 1));
});
test("delete chain has no actwho filter for admin", async () => {
  const db = okDb();
  await deleteEntry(db, ADMIN, 5);
  assert.ok(!filters(writes(db, "delete")[0]).some((f) => f[1] === "actwho"));
});

// --- zero rows affected → locked (a prior select saying "editable" must not matter) ---
test("update: any select says the row is editable but the write matches 0 rows → locked", async () => {
  const db = fakeDb((chain) => {
    if (chain[0][1] === "tblcase") return { data: { caseid: 90001 }, error: null };
    if (has(chain, "update")) return { data: [], error: null };
    return { data: { actid: 5, actbilled: false, actbillid: null, actwho: 1 }, error: null };
  });
  await assert.rejects(updateEntry(db, STAFF, 5, EDIT), refused("locked"));
});
test("delete: the write matches 0 rows → locked", async () => {
  const db = fakeDb((chain) => (has(chain, "delete") ? { data: [], error: null } : { data: { actid: 5 }, error: null }));
  await assert.rejects(deleteEntry(db, STAFF, 5), refused("locked"));
});
test("locked message is the lane's exact wording", () => {
  assert.equal(errorMessage("locked"), "This entry can't be changed");
});
test("update/delete return the row's date and person for the week redirect", async () => {
  const want = { actdate: "2026-09-10", actwho: 2 };
  assert.deepEqual(await updateEntry(okDb(), ADMIN, 5, EDIT), want);
  assert.deepEqual(await updateEntry(okDb(), ADMIN, 5, { ...ORIG, orig: ORIG }), want); // no-change path reads actwho too
  assert.deepEqual(await deleteEntry(okDb(), ADMIN, 5), want);
});
test("a DB write error is a plain Error, not a TimeInputError", async () => {
  const db = fakeDb(() => ({ data: null, error: { message: "boom" } }));
  await assert.rejects(deleteEntry(db, STAFF, 5), (e) => !(e instanceof TimeInputError));
});

// --- payload: only changed whitelist columns ---
test("update payload holds only the changed columns", async () => {
  const db = okDb();
  await updateEntry(db, STAFF, 5, EDIT);
  assert.deepEqual(payload(db), { acthrs: "2.125", actdescription: "New" });
});
test("update payload never carries forged actwho/actbilled/actbillid", async () => {
  const db = okDb();
  await updateEntry(db, STAFF, 5, { ...EDIT, actwho: 2, actbilled: true, actbillid: 7 });
  for (const k of ["actwho", "actbilled", "actbillid"]) assert.ok(!(k in payload(db)), k);
});
test("update with no orig writes all four whitelist columns", async () => {
  const db = okDb();
  await updateEntry(db, STAFF, 5, { ...ORIG });
  assert.deepEqual(Object.keys(payload(db)).sort(), ["actcaseid", "actdate", "actdescription", "acthrs"]);
});
test("unchanged case is not re-checked on tblcase; a changed case is", async () => {
  const same = okDb();
  await updateEntry(same, STAFF, 5, EDIT);
  assert.equal(same.chains.filter((c) => c[0][1] === "tblcase").length, 0);
  const moved = okDb();
  await updateEntry(moved, STAFF, 5, { ...EDIT, caseId: "90002" });
  assert.equal(moved.chains.filter((c) => c[0][1] === "tblcase").length, 1);
});
test("changed case that doesn't exist → 'case', no write", async () => {
  const db = fakeDb((chain) => (chain[0][1] === "tblcase" ? { data: null, error: null } : { data: [{ actid: 5 }], error: null }));
  await assert.rejects(updateEntry(db, STAFF, 5, { ...EDIT, caseId: "999999" }), refused("case"));
  assert.equal(writes(db, "update").length, 0);
});
test("nothing changed → no update statement, success while the filtered read finds the row", async () => {
  const db = okDb();
  assert.equal((await updateEntry(db, STAFF, 5, { ...ORIG, orig: ORIG })).actdate, "2026-09-10");
  assert.equal(writes(db, "update").length, 0);
  assert.deepEqual(filters(db.chains[0]), [["eq", "actid", 5], ["eq", "actbilled", false], ["is", "actbillid", null], ["eq", "actwho", 1]]);
});
test("nothing changed on a billed/foreign row (filtered read finds 0) → locked", async () => {
  const db = okDb([]);
  await assert.rejects(updateEntry(db, STAFF, 5, { ...ORIG, orig: ORIG }), refused("locked"));
});

// --- personId null ---
test("update with personId null → 'unlinked', no DB call", async () => {
  const db = okDb();
  await assert.rejects(updateEntry(db, { personId: null, role: "admin" }, 5, EDIT), refused("unlinked"));
  assert.equal(db.chains.length, 0);
});
test("delete with personId null → 'unlinked', no DB call", async () => {
  const db = okDb();
  await assert.rejects(deleteEntry(db, { personId: null, role: "admin" }, 5), refused("unlinked"));
  assert.equal(db.chains.length, 0);
});
test("the actions refuse a null personId themselves before calling the lib", () => {
  const src = readFileSync(new URL("../../app/time/actions.ts", import.meta.url), "utf8");
  const n = src.match(/if \(session\.personId == null\) code = "unlinked";/g)?.length ?? 0;
  assert.equal(n, 3); // addEntry, updateEntry, deleteEntry
});

// --- same validation as insert ---
for (const [field, bad, code] of [["hours", "0", "hours"], ["hours", "25", "hours"], ["hours", "1.0625", "hours"], ["description", "  ", "description"], ["date", "2026-02-30", "date"], ["caseId", "abc", "case"]]) {
  test(`update refuses ${field}=${JSON.stringify(bad)} with '${code}', no write`, async () => {
    const db = okDb();
    await assert.rejects(updateEntry(db, STAFF, 5, { ...EDIT, [field]: bad }), refused(code));
    assert.equal(writes(db, "update").length, 0);
  });
}

// --- loadEntry (page read) ---
test("loadEntry: staff read filters by own actwho; admin read does not", async () => {
  const s = okDb({ actid: 5 });
  await loadEntry(s, STAFF, 5);
  assert.deepEqual(filters(s.chains[0]), [["eq", "actid", 5], ["eq", "actwho", 1]]);
  const a = okDb({ actid: 5 });
  await loadEntry(a, ADMIN, 5);
  assert.deepEqual(filters(a.chains[0]), [["eq", "actid", 5]]);
});

// --- UI shape (journey 03 trap + no confirm) ---
test("no browser confirm and no client component on the time pages", () => {
  for (const f of ["entry-form.tsx", "page.tsx", "[id]/page.tsx", "actions.ts"]) {
    const src = readFileSync(new URL(`../../app/time/${f}`, import.meta.url), "utf8");
    assert.doesNotMatch(src, /confirm\(/, f);
    assert.doesNotMatch(src, /["']use client["']/, f);
  }
});
test("/time itself renders no Save/Delete buttons (only /time/[id] passes submitLabel)", () => {
  const src = readFileSync(new URL("../../app/time/page.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(src, /submitLabel|deleteEntry/);
});
