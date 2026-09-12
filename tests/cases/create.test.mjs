// Unit tests for lib/cases/create.ts (new case, per legacy frmCaseAdd) with a fake client. Expected values are literals.
import { test } from "node:test";
import assert from "node:assert/strict";
import { nextCaseId, insertCase, newCaseDefaults, parseNewCaseForm, createCase, safeReturnTo, returnWith } from "../../lib/cases/create.ts";

/** Fake PostgREST builder: records every call; the terminal result comes from `result(calls)`. */
function fakeDb(result) {
  const calls = [];
  return {
    calls,
    from(table) {
      calls.push(["from", table]);
      const b = new Proxy({}, {
        get(_, k) {
          if (k === "then") return (res, rej) => Promise.resolve(result(calls)).then(res, rej);
          return (...args) => { calls.push([k, ...args]); return b; };
        },
      });
      return b;
    },
  };
}
const insertedPayload = (db) => db.calls.find((c) => c[0] === "insert")?.[1];

test("nextCaseId: max 1234 → 1235", async () => {
  const db = fakeDb(() => ({ data: [{ caseid: 1234 }], error: null }));
  assert.equal(await nextCaseId(db), 1235);
  assert.deepEqual(db.calls, [["from", "tblcase"], ["select", "caseid"], ["order", "caseid", { ascending: false }], ["limit", 1]]);
});
test("nextCaseId: empty table → 1", async () => {
  assert.equal(await nextCaseId(fakeDb(() => ({ data: [], error: null }))), 1);
});

test("defaults: title TBD, status Open, start date is the injected today", () => {
  assert.deepEqual(newCaseDefaults(new Date("2026-03-08T04:30:00Z")) /* 11:30pm EST */, { casetitle: "TBD", casestartdate: "2026-03-07", status: "Open" });
});

const FIELDS = { caseid: 990123, casetitle: "TBD", casestartdate: "2026-03-07", status: "Open", tabranch: "Hartford", caseatty: 7, caseclient: 9 };

test("insertCase: payload carries the explicit caseid and returns the new id", async () => {
  const db = fakeDb(() => ({ data: { caseid: 990123 }, error: null }));
  assert.deepEqual(await insertCase(db, FIELDS), { ok: true, id: 990123 });
  assert.equal(insertedPayload(db).caseid, 990123);
  assert.deepEqual(db.calls[0], ["from", "tblcase"]);
});

test("insertCase: 23505 → Case number already exists", async () => {
  const db = fakeDb(() => ({ data: null, error: { code: "23505", message: 'duplicate key value violates unique constraint "tblcase_pkey"' } }));
  assert.deepEqual(await insertCase(db, FIELDS), { ok: false, error: "Case number already exists" });
});

test("insertCase: a non-23505 error → generic message, not the duplicate text, no raw DB text", async () => {
  const raw = 'insert or update on table "tblcase" violates foreign key constraint "tblcase_caseatty_fkey"';
  const orig = console.error; console.error = () => {};
  try {
    const res = await insertCase(fakeDb(() => ({ data: null, error: { code: "23503", message: raw } })), FIELDS);
    assert.equal(res.ok, false);
    assert.equal(res.error, "Save failed; the case was not created.");
    assert.notEqual(res.error, "Case number already exists");
    assert.ok(!res.error.includes("violates") && !res.error.includes("tblcase"));
  } finally { console.error = orig; }
});

test("insertCase: a non-positive caseid is refused before any DB call", async () => {
  const db = fakeDb(() => { throw new Error("no DB call expected"); });
  assert.equal((await insertCase(db, { ...FIELDS, caseid: 0 })).ok, false);
  assert.equal(db.calls.length, 0);
});

const form = (o) => { const f = new FormData(); for (const [k, v] of Object.entries(o)) f.set(k, v); return f; };
const FORM = { caseid: " 990124 ", casetitle: "TBD", casesubject: "Ladder", casecaption: "A v. B", casestartdate: "2026-03-07", status: "Open", tabranch: "Hartford", caseatty: "7", caseclient: "9", caseinquiry: "" };

test("parseNewCaseForm: typed payload with the explicit case number", () => {
  assert.deepEqual(parseNewCaseForm(form(FORM)), {
    caseid: 990124, casetitle: "TBD", casesubject: "Ladder", casecaption: "A v. B", casestartdate: "2026-03-07",
    status: "Open", tabranch: "Hartford", caseatty: 7, caseclient: 9, caseinquiry: null,
  });
});
test("parseNewCaseForm: drops columns the create form does not offer", () => {
  const p = parseNewCaseForm(form({ ...FORM, casenotes: "x", numunpaidbills: "5", billingalert: "on", billingalert__present: "1" }));
  assert.ok(!("casenotes" in p) && !("numunpaidbills" in p) && !("billingalert" in p));
});
test("createCase: missing attorney → user message, no insert", async () => {
  const db = fakeDb(() => { throw new Error("no DB call expected"); });
  assert.deepEqual(await createCase(db, form({ ...FORM, caseatty: "" })), { ok: false, error: "Attorney is required" });
  assert.deepEqual(await createCase(db, form({ ...FORM, caseid: "12a" })), { ok: false, error: "Case number must be a positive whole number" });
  const noClient = { ...FORM }; delete noClient.caseclient;
  assert.deepEqual(await createCase(db, form(noClient)), { ok: false, error: "Client is required" });
  assert.equal(db.calls.length, 0);
});

test("returnTo: accepts /cases/new with or without a query", () => {
  assert.equal(safeReturnTo("/cases/new"), "/cases/new");
  assert.equal(safeReturnTo("/cases/new?x=1"), "/cases/new?x=1");
});
for (const bad of ["https://evil.com/cases/new", "//evil.com/cases/new", "/\\evil.com", "/cases/newx", "/cases/new/../x", "/attorneys", "/cases/new\r\nX: y", "cases/new", "", null, ["/cases/new"]]) {
  test(`returnTo: rejects ${JSON.stringify(bad)}`, () => assert.equal(safeReturnTo(bad), null));
}
test("returnWith: sets the new id and keeps the other picks", () => {
  assert.equal(returnWith("/cases/new?client=9", "attorney", 7), "/cases/new?client=9&attorney=7");
  assert.equal(returnWith("/cases/new?attorney=3&client=9", "attorney", 7), "/cases/new?attorney=7&client=9");
});
