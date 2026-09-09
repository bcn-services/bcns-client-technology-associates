// tests/migration/load.test.mjs — scripts/migrate/load.mjs against the harness DB.
// Run directly (package.json's `test` glob does not reach tests/migration/):
//   node_modules/.bin/tsx --test --test-concurrency=1 tests/migration/*.test.mjs
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { DB_URL, sql, one, resetDb } from "../foundation/harness.mjs";

const ROOT = new URL("../..", import.meta.url).pathname;
const LOAD = join(ROOT, "scripts/migrate/load.mjs");
const SMALL = join(ROOT, "tests/migration/fixtures/export-small.sql");
const BAD = join(ROOT, "tests/migration/fixtures/export-bad.sql");

// The 20 legacy tables, written out here on purpose: this literal — not anything the
// script exports — is what the clear-scope assertions are measured against.
const LEGACY_20 = [
  "tblstates", "tblbranches", "tblcasestatus", "tblcasepriority", "tblcasewaitingfor",
  "tblbillingnames", "tblexptype", "tblfirm", "tblattorney", "tblclient",
  "tblinquiry", "tblcase", "tblbills", "tblactivity", "tblexpenses",
  "tblfundsrcvd", "tblsrvauth", "tblcaseresult", "tbl_scannedbillandcheck", "tblscanneddocument",
];
const FIXTURE_MAX_CASEID = 5010;

function runLoad(file, { tz = "UTC" } = {}) {
  try {
    const stdout = execFileSync("node", [LOAD, file], {
      encoding: "utf8", stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env, MIGRATE_DB_URL: DB_URL, TZ: tz, PGTZ: tz },
    });
    return { ok: true, stdout, stderr: "" };
  } catch (e) {
    return { ok: false, code: e.status, stdout: String(e.stdout ?? ""), stderr: String(e.stderr ?? "") };
  }
}
/** Read one scalar in an explicit timezone (harness sql() cannot vary TZ per call). */
function readTz(query, tz) {
  return execFileSync("psql", ["-X", "-q", "-v", "ON_ERROR_STOP=1", "-d", DB_URL, "-At"], {
    input: query, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"],
    env: { ...process.env, TZ: tz, PGTZ: tz },
  }).trim();
}
const count = (t) => Number(one(`select count(*) from ${t};`));
function clearLegacy() { // test-side setup only — never the script's own clearing path
  sql(`begin; set session_replication_role = replica; ${[...LEGACY_20].reverse().map((t) => `delete from ${t};`).join(" ")} commit;`);
}

before(() => { resetDb(); });

test("loads every table with the exact fixture row counts, and reports them", () => {
  clearLegacy();
  const r = runLoad(SMALL);
  assert.equal(r.ok, true, r.stderr);
  for (const t of LEGACY_20) {
    assert.equal(count(t), 3, `${t} row count`);
    assert.match(r.stdout, new RegExp(`^${t} 3$`, "m"), `${t} not reported on stdout`);
  }
  assert.match(r.stdout, /^total 60$/m);
});

test("values translate without coercion: ntext bytes, booleans, dates, NULL", () => {
  const notes = "Line one; semicolon kept\nit's line two";
  assert.equal(
    one(`select encode(convert_to(casenotes,'UTF8'),'hex') from tblcase where caseid = 5001;`),
    Buffer.from(notes, "utf8").toString("hex"),
    "ntext value did not round-trip byte-for-byte",
  );
  assert.equal(one(`select active::text from tblexptype where exptypeid = 21;`), "true");
  assert.equal(one(`select active::text from tblexptype where exptypeid = 22;`), "false");
  // DateTime at 23:30:00 landing in a `date` column: same calendar date under either TZ.
  assert.equal(readTz(`select billdate::text from tblbills where billid = 71;`, "UTC"), "2019-03-05");
  assert.equal(readTz(`select billdate::text from tblbills where billid = 71;`, "America/New_York"), "2019-03-05");
  assert.equal(one(`select inqtime::text from tblinquiry where id = 61;`), "23:30:00");
  // A 7-digit-fraction DateTime2 keeps microsecond precision, and the stored instant does not
  // move with the operator's timezone — the load pins the session to UTC.
  const dt2 = `select to_char(casestatlastupdated at time zone 'UTC','YYYY-MM-DD HH24:MI:SS.US') from tblcase where caseid = 5001;`;
  assert.equal(readTz(dt2, "UTC"), "2021-07-04 08:15:30.123457");
  const shifted = runLoad(SMALL, { tz: "America/New_York" });
  assert.equal(shifted.ok, true, shifted.stderr);
  assert.equal(readTz(dt2, "America/New_York"), "2021-07-04 08:15:30.123457", "the stored instant moved with the loading session's timezone");
  assert.equal(one(`select expamount::text from tblexpenses where expid = 91;`), "87.40");
  assert.equal(one(`select expcaseid::text from tblexpenses where expid = 93;`), "999999", "orphan expcaseid was altered");
  // A NULL stays NULL and never becomes ''.
  assert.equal(one(`select frmcity is null from tblfirm where frmid = 33;`), "t", "NULL text column was coerced");
  assert.equal(one(`select clientnotes is null from tblclient where clientid = 53;`), "f", "'' was turned into NULL");
  assert.equal(one(`select length(clientnotes)::text from tblclient where clientid = 53;`), "0");
});

test("re-running is idempotent and syncSequences moves identity past the fixture max", () => {
  const r = runLoad(SMALL);
  assert.equal(r.ok, true, r.stderr);
  for (const t of LEGACY_20) assert.equal(count(t), 3, `${t} duplicated on reload`);
  const next = Number(one(
    `insert into tblcase (casetitle, caseatty, caseclient, tabranch, status, casestartdate)
     values ('x', 41, 51, 'Newark', 'Open', date '2022-01-01') returning caseid;`,
  ));
  assert.ok(next > FIXTURE_MAX_CASEID, `next caseid ${next} is not past the fixture max ${FIXTURE_MAX_CASEID}`);
  sql(`delete from tblcase where caseid = ${next};`);
});

test("clears only the 20: profiles and bank_transactions survive, audit_log stays empty", () => {
  sql(`insert into auth.users (id, email) values ('22222222-2222-2222-2222-222222222222','m@example.test') on conflict do nothing;
       insert into profiles (id, email, role, personid) values ('22222222-2222-2222-2222-222222222222','m@example.test','admin',11) on conflict do nothing;
       insert into bank_transactions (bankaccount, postedon, amount, description, expid)
       values ('op', date '2019-03-01', 87.40, 'mileage', 91) on conflict do nothing;
       delete from audit_log;`);
  const r = runLoad(SMALL);
  assert.equal(r.ok, true, r.stderr);
  assert.equal(count("profiles"), 1, "profiles was cleared by the load");
  assert.equal(count("bank_transactions"), 1, "bank_transactions was cleared by the load");
  assert.equal(count("audit_log"), 0, "the audit trigger fired — replica mode was not in effect");
});

test("a mid-file failure rolls back the clear as well as the inserts", () => {
  const before20 = LEGACY_20.map((t) => count(t));
  assert.deepEqual(before20, LEGACY_20.map(() => 3), "precondition: fixture is loaded");
  const r = runLoad(BAD);
  assert.equal(r.ok, false, "the bad fixture was accepted");
  assert.deepEqual(LEGACY_20.map((t) => count(t)), before20, "a partial change survived the failed load");
});

test("unknown table is skipped on stderr; a bad value aborts naming table.column and leaves every table empty", () => {
  clearLegacy();
  const r = runLoad(BAD);
  assert.equal(r.ok, false, "the out-of-range smallint did not abort the load");
  assert.match(r.stderr, /skipped:.*tblactive/i, "the unknown table was not listed on stderr");
  assert.equal(one(`select to_regclass('public.tblactive') is null;`), "t", "tblActive was created rather than skipped");
  assert.match(r.stderr, /tblbillingnames\.personid: ERROR:.*smallint out of range/i);
  for (const t of LEGACY_20) assert.equal(count(t), 0, `${t} was left with rows after the aborted load`);
});

test("the script never names profiles, bank_transactions or audit_log, and never alters constraints or triggers", () => {
  const src = readFileSync(LOAD, "utf8");
  const code = src.split("\n").filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join("\n");
  for (const forbidden of ["profiles", "bank_transactions", "audit_log"]) {
    assert.equal(new RegExp(`\\b${forbidden}\\b`).test(code), false, `load.mjs names ${forbidden}`);
  }
  assert.equal(/alter\s+table/i.test(code), false, "load.mjs alters a table");
  assert.equal(/disable\s+trigger|drop\s+constraint|validate\s+constraint/i.test(code), false, "load.mjs changes triggers or constraints");
  assert.equal(/session_replication_role\s*=\s*replica/.test(code), true, "replica mode is not set");
});

test("a UTF-16 LE file with a BOM loads identically to the UTF-8 one", () => {
  const utf8 = readFileSync(SMALL);
  const text = utf8.subarray(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf])) ? utf8.subarray(3).toString("utf8") : utf8.toString("utf8");
  const wide = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(text, "utf16le")]);
  const path = join(mkdtempSync(join(tmpdir(), "ta-migrate-")), "export-utf16.sql");
  writeFileSync(path, wide);
  const r = runLoad(path);
  assert.equal(r.ok, true, r.stderr);
  for (const t of LEGACY_20) assert.equal(count(t), 3, `${t} row count from the UTF-16 file`);
  assert.equal(
    one(`select encode(convert_to(casenotes,'UTF8'),'hex') from tblcase where caseid = 5001;`),
    Buffer.from("Line one; semicolon kept\nit's line two", "utf8").toString("hex"),
  );
});
