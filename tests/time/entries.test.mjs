// Unit tests for lib/time/entries.ts insertEntry with a fake PostgREST client (pattern: tests/cases/create.test.mjs).
// One guard per test; each refusal asserts the specific error code AND zero inserts.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { insertEntry, TimeInputError, errorMessage, NOT_LINKED } from "../../lib/time/entries.ts";

/** Fake builder: records every call; `caseRow` is what the tblcase select returns. */
function fakeDb({ caseRow = { caseid: 90001 }, insertError = null } = {}) {
  const calls = [];
  let table;
  return {
    calls,
    from(t) {
      table = t;
      calls.push(["from", t]);
      const b = new Proxy({}, {
        get(_, k) {
          if (k === "then") {
            const r = table === "tblcase" ? { data: caseRow, error: null } : { data: null, error: insertError };
            return (res, rej) => Promise.resolve(r).then(res, rej);
          }
          return (...args) => { calls.push([k, ...args]); return b; };
        },
      });
      return b;
    },
  };
}
const inserts = (db) => db.calls.filter((c) => c[0] === "insert");
const payload = (db) => inserts(db)[0]?.[1];
const LINKED = { personId: 1 };
const OK = { caseId: "90001", date: "2026-09-12", hours: "1.5", description: "Reviewed file" };
const refused = (code) => (e) => e instanceof TimeInputError && e.code === code;

test("happy path: inserts exactly the five columns, actwho from the session, no actbilled/actbillid", async () => {
  const db = fakeDb();
  await insertEntry(db, LINKED, OK);
  assert.deepEqual(payload(db), { actcaseid: 90001, actdate: "2026-09-12", actdescription: "Reviewed file", acthrs: "1.5", actwho: 1 });
  assert.deepEqual(db.calls.at(-2), ["from", "tblactivity"]);
});

// (a) actwho comes from the session
test("guard a: a forged actwho in the input is ignored — actwho is session.personId", async () => {
  const db = fakeDb();
  await insertEntry(db, { personId: 2 }, { ...OK, actwho: 999, actWho: "999" });
  assert.equal(payload(db).actwho, 2);
});
test("guard a: the action never reads actwho from the form and passes the session to insertEntry", () => {
  const src = readFileSync(new URL("../../app/time/actions.ts", import.meta.url), "utf8");
  assert.doesNotMatch(src, /get\(\s*["']actwho/);
  assert.match(src, /insertEntry\(.*,\s*session,\s*input\)/);
});

// (b) case exists — one select on tblcase filtered by caseid
test("guard b: case 999999 (no tblcase row) is refused with code 'case' and nothing inserted", async () => {
  const db = fakeDb({ caseRow: null });
  await assert.rejects(insertEntry(db, LINKED, { ...OK, caseId: "999999" }), refused("case"));
  assert.equal(inserts(db).length, 0);
});
test("guard b: the case check is a select on tblcase filtered by caseid", async () => {
  const db = fakeDb();
  await insertEntry(db, LINKED, OK);
  assert.deepEqual(db.calls.slice(0, 3), [["from", "tblcase"], ["select", "caseid"], ["eq", "caseid", 90001]]);
});
test("non-numeric case number is refused before any DB call", async () => {
  const db = fakeDb();
  await assert.rejects(insertEntry(db, LINKED, { ...OK, caseId: "abc" }), refused("case"));
  assert.equal(db.calls.length, 0);
});

// (c) hours ≤ 0
test("guard c: hours 0 refused with code 'hours', nothing inserted", async () => {
  const db = fakeDb();
  await assert.rejects(insertEntry(db, LINKED, { ...OK, hours: "0" }), refused("hours"));
  assert.equal(inserts(db).length, 0);
});
// (d) hours > 24
test("guard d: hours 25 refused with code 'hours', nothing inserted", async () => {
  const db = fakeDb();
  await assert.rejects(insertEntry(db, LINKED, { ...OK, hours: "25" }), refused("hours"));
  assert.equal(inserts(db).length, 0);
});
test("guard d: hours 24.001 refused with code 'hours', nothing inserted", async () => {
  const db = fakeDb();
  await assert.rejects(insertEntry(db, LINKED, { ...OK, hours: "24.001" }), refused("hours"));
  assert.equal(inserts(db).length, 0);
});
// (e) at most 3 decimals
test("guard e: hours 1.0625 (4 decimals) refused with code 'hours', nothing inserted", async () => {
  const db = fakeDb();
  await assert.rejects(insertEntry(db, LINKED, { ...OK, hours: "1.0625" }), refused("hours"));
  assert.equal(inserts(db).length, 0);
});
for (const h of ["24", "0.125", "1.125"]) {
  test(`hours ${h} accepted and inserted`, async () => {
    const db = fakeDb();
    await insertEntry(db, LINKED, { ...OK, hours: h });
    assert.equal(payload(db).acthrs, h);
  });
}
for (const h of ["", "abc", "-1", "1e1", "1,5"]) {
  test(`hours ${JSON.stringify(h)} refused, nothing inserted`, async () => {
    const db = fakeDb();
    await assert.rejects(insertEntry(db, LINKED, { ...OK, hours: h }), refused("hours"));
    assert.equal(inserts(db).length, 0);
  });
}

// (f) description non-empty
test("guard f: empty description refused with code 'description', nothing inserted", async () => {
  const db = fakeDb();
  await assert.rejects(insertEntry(db, LINKED, { ...OK, description: "" }), refused("description"));
  assert.equal(inserts(db).length, 0);
});
test("guard f: whitespace-only description refused with code 'description', nothing inserted", async () => {
  const db = fakeDb();
  await assert.rejects(insertEntry(db, LINKED, { ...OK, description: "  \n\t " }), refused("description"));
  assert.equal(inserts(db).length, 0);
});

// (g) personId null
test("guard g: a session with personId null is refused with code 'unlinked' and makes no DB call", async () => {
  const db = fakeDb();
  await assert.rejects(insertEntry(db, { personId: null }, OK), refused("unlinked"));
  assert.equal(inserts(db).length, 0);
  assert.equal(db.calls.length, 0);
});
test("guard g: the action refuses a null personId itself before calling insertEntry", () => {
  const src = readFileSync(new URL("../../app/time/actions.ts", import.meta.url), "utf8");
  assert.match(src, /if \(session\.personId == null\) code = "unlinked";[^\n]*\n\s*else \{/);
});
test("unlinked message text is the lane's exact wording", () => {
  assert.equal(errorMessage("unlinked"), "Your login isn't linked to a person — an admin can set it on /users");
  assert.equal(NOT_LINKED, errorMessage("unlinked"));
});

// (h) hours stored as entered
test("guard h: '1.5' reaches the insert as exactly '1.5'", async () => {
  const db = fakeDb();
  await insertEntry(db, LINKED, { ...OK, hours: "1.5" });
  assert.equal(payload(db).acthrs, "1.5");
});
test("guard h: '2.125' reaches the insert as exactly '2.125' (not rounded to 2.13 or 2.1)", async () => {
  const db = fakeDb();
  await insertEntry(db, LINKED, { ...OK, hours: "2.125" });
  assert.equal(payload(db).acthrs, "2.125");
});

test("invalid date refused with code 'date', nothing inserted", async () => {
  for (const date of ["", "2026-02-30", "09/12/2026"]) {
    const db = fakeDb();
    await assert.rejects(insertEntry(db, LINKED, { ...OK, date }), refused("date"));
    assert.equal(inserts(db).length, 0);
  }
});
test("a DB insert error throws a plain Error (action maps it to the generic message)", async () => {
  const db = fakeDb({ insertError: { code: "23503", message: "fk violation" } });
  await assert.rejects(insertEntry(db, LINKED, OK), (e) => !(e instanceof TimeInputError));
  assert.equal(errorMessage("failed"), "Save failed; the entry was not added.");
});

test("entry-form and page are server components (no 'use client')", () => {
  for (const f of ["entry-form.tsx", "page.tsx"]) {
    assert.doesNotMatch(readFileSync(new URL(`../../app/time/${f}`, import.meta.url), "utf8"), /["']use client["']/);
  }
});
