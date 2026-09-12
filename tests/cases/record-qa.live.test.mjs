/**
 * QA checks for the case record (LANE item 4), driving the real saveCase / loadCaseRecord.
 * Live tests use the Supabase project in .env.local, snapshot fixture case 90001 and restore it.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { loadEnvLocal } from "../app-shell/seed-e2e.ts";
import { createServerClient } from "../../lib/db/client.ts";
import { FIELDS, BADGE, formValue, saveCase, badges } from "../../lib/cases/record.ts";

loadEnvLocal();
const skip = process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY ? false : "no Supabase config in .env.local";
const ID = 90001;
let db, snapshot;
const ok = ({ data, error }) => { if (error) throw new Error(error.message); return data; };
const readCase = async () => ok(await db.from("tblcase").select("*").eq("caseid", ID).single());

function formFor(row, overrides = {}) {
  const f = new FormData();
  for (const fl of FIELDS) {
    if (fl.kind === "bool") { f.set(`${fl.col}__present`, "1"); if (row[fl.col] === true) f.set(fl.col, "on"); continue; }
    f.set(fl.col, formValue(fl, row));
  }
  for (const [k, v] of Object.entries(overrides)) f.set(k, v);
  return f;
}

before(async () => { if (!skip) { db = createServerClient(); snapshot = await readCase(); } });
after(async () => {
  if (skip || !snapshot) return;
  const { caseid, ...rest } = snapshot;
  ok(await db.from("tblcase").update(rest).eq("caseid", caseid));
});

test("badge notice list is exact and case-insensitive (First/'1st ' variants)", () => {
  assert.deepEqual(badges({}, ["First"], []), [], "'First' is not on the spec list");
  assert.deepEqual(badges({}, [" 1ST "], []), [BADGE.unpaid]);
  assert.deepEqual(badges({}, ["Partial"], []), [], "prefix is not a match");
  assert.deepEqual(badges({}, [], ["Declined"]), [BADGE.unapproved]);
  assert.deepEqual(badges({}, [], ["Unapproved"]), [], "'Unapproved' contains 'approved' — literal spec reading");
});

test("round-trip of a migrated row with nulls/dates/numbers writes nothing", { skip }, async () => {
  ok(await db.from("tblcase").update({ casesubject: null, caseenddate: null, casestatsubpriority: 3, casestatduedate: "2026-05-05", casenotes: "a\nb" }).eq("caseid", ID));
  const cur = await readCase();
  const f = formFor(cur);
  f.set("casenotes", "a\r\nb"); // browsers post CRLF
  assert.deepEqual(await saveCase(db, ID, f, new Date()), {});
  assert.deepEqual(await readCase(), cur);
});

test("stale editor: notes-only save does not revert a column changed out-of-band", { skip }, async () => {
  const stale = await readCase(); // user A loads the form
  ok(await db.from("tblcase").update({ casesubject: "QA out-of-band" }).eq("caseid", ID)); // user B saves
  const w = await saveCase(db, ID, formFor(stale, { casenotes: `qa stale ${Date.now()}` }), new Date());
  const now = await readCase();
  assert.equal(now.casesubject, "QA out-of-band", `A's notes-only save rewrote casesubject; wrote ${JSON.stringify(Object.keys(w))}`);
});
