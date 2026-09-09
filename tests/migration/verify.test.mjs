// tests/migration/verify.test.mjs — scripts/migrate/verify.mjs against the harness DB.
// Run directly (package.json's `test` glob does not reach tests/migration/):
//   node_modules/.bin/tsx --test --test-concurrency=1 tests/migration/*.test.mjs
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { DB_URL, sql, one, resetDb } from "../foundation/harness.mjs";

const ROOT = new URL("../..", import.meta.url).pathname;
const LOAD = join(ROOT, "scripts/migrate/load.mjs");
const VERIFY = join(ROOT, "scripts/migrate/verify.mjs");
const PARSE = join(ROOT, "scripts/migrate/parse.mjs");
const SMALL = join(ROOT, "tests/migration/fixtures/export-small.sql");

// Written out here on purpose — these literals, not anything the scripts export, are what the
// assertions are measured against.
const LEGACY_20 = [
  "tblstates", "tblbranches", "tblcasestatus", "tblcasepriority", "tblcasewaitingfor",
  "tblbillingnames", "tblexptype", "tblfirm", "tblattorney", "tblclient",
  "tblinquiry", "tblcase", "tblbills", "tblactivity", "tblexpenses",
  "tblfundsrcvd", "tblsrvauth", "tblcaseresult", "tbl_scannedbillandcheck", "tblscanneddocument",
];
const NO_IDENTITY = ["tblstates", "tblbranches", "tblcasestatus", "tblcasepriority", "tblcasewaitingfor"];
const NOT_VALID_FKS = 26;
const FIXTURE_EXPAMOUNT_SUM = "104.45";

function run(script, file, { tz = "UTC" } = {}) {
  const r = spawnSync("node", file === undefined ? [script] : [script, file], {
    encoding: "utf8", env: { ...process.env, MIGRATE_DB_URL: DB_URL, TZ: tz, PGTZ: tz },
  });
  return { code: r.status, stdout: r.stdout, stderr: r.stderr };
}
const verify = (opts) => run(VERIFY, SMALL, opts);
/** verify.mjs with extra CLI flags. */
function verifyArgs(file, ...flags) {
  const r = spawnSync("node", [VERIFY, file, ...flags], {
    encoding: "utf8", env: { ...process.env, MIGRATE_DB_URL: DB_URL, TZ: "UTC", PGTZ: "UTC" },
  });
  return { code: r.status, stdout: r.stdout, stderr: r.stderr };
}
/** A copy of the fixture export with every INSERT for `tables` stripped — a truncated scripter run. */
function exportWithout(...tables) {
  const kept = readFileSync(SMALL, "utf8").split("\n").filter((l) => !tables.some((t) => l.includes(`[${t}]`)));
  const f = join(mkdtempSync(join(tmpdir(), "mig-")), `without-${tables.join("-")}.sql`);
  writeFileSync(f, kept.join("\n"));
  return f;
}
function reload() {
  const r = run(LOAD, SMALL);
  assert.equal(r.code, 0, r.stderr);
}
const count = (t) => Number(one(`select count(*) from ${t};`));
/** The exact stdout row for a table in the counts table. */
const countRow = (out, t) => out.split("\n").find((l) => l.startsWith(`| ${t} |`));
const sumRow = (out, k) => out.split("\n").find((l) => l.startsWith(`| ${k} |`));

before(() => { resetDb(); reload(); });

test("a faithful load verifies clean: 20 equal counts, the planted orphan, planted drift, exit 0", () => {
  assert.equal(count("tblexpenses"), 3, "precondition: fixture is loaded");
  const r = verify();
  assert.equal(r.code, 0, r.stdout + r.stderr);
  for (const t of LEGACY_20) assert.match(countRow(r.stdout, t), /\| 3 \| 3 \|.*\| ok \|$/, `${t} count row: ${countRow(r.stdout, t)}`);
  assert.match(r.stdout, /^\*\*RESULT: counts, sums, sequence positions and table coverage all check out\.\*\*$/m);
  // The five identity-less lookup tables report n/a, not a null and not a mismatch.
  for (const t of NO_IDENTITY) assert.match(countRow(r.stdout, t), /\| — \| ok \|$/, `${t} identity cell`);
  // The orphan the fixture plants, counted under its own NOT VALID constraint.
  assert.match(r.stdout, /^\| tblexpenses_expcaseid_fkey \(tblexpenses\.expcaseid → tblcase\.caseid\) \| 1 \|$/m);
  assert.match(r.stdout, new RegExp(`^${NOT_VALID_FKS} NOT VALID FK constraints found — expected ${NOT_VALID_FKS}\\.$`, "m"));
  assert.equal(/the schema has changed/.test(r.stdout), false);
  // Drift the fixture plants: caseid 5001's numunpaidbills, caseid 5010's numunapprovedsa.
  assert.match(r.stdout, /^\| tblcase\.numunpaidbills \| 1 \| 5001 \|$/m);
  assert.match(r.stdout, /^\| tblcase\.numunapprovedsa \| 1 \| 5010 \|$/m);
  // ntext-derived lengths are reported.
  assert.match(r.stdout, /^\| tblcase\.casenotes \| 38 \|$/m);
});

test("orphans and drift alone never fail the run", () => {
  assert.equal(one(`select count(*)::text from tblexpenses e left join tblcase c on e.expcaseid = c.caseid where c.caseid is null;`), "1", "precondition: the orphan is present");
  assert.equal(one(`select numunpaidbills::text from tblcase where caseid = 5001;`), "7", "precondition: the planted drift is present");
  assert.equal(verify().code, 0, "an informational finding failed the run");
});

test("a deleted row exits 1 and marks both the tblexpenses count and the expamount sum", () => {
  assert.equal(count("tblexpenses"), 3, "precondition: fixture is loaded");
  sql(`begin; set session_replication_role = replica; delete from tblexpenses where expid = 92; commit;`);
  try {
    const r = verify();
    assert.equal(r.code, 1, "a missing row did not fail the run");
    assert.match(countRow(r.stdout, "tblexpenses"), /\| 3 \| 2 \|.*\| \*\*MISMATCH\*\* \|$/);
    assert.match(sumRow(r.stdout, "tblexpenses.expamount"), /\| 104\.45 \| 92\.45 \| \*\*MISMATCH\*\* \|$/);
    assert.match(r.stdout, /^\*\*RESULT: FAILED — do not hand over\.\*\*$/m);
  } finally { reload(); }
});

test("a count mismatch alone exits 1, with no numeric column to give it away", () => {
  // tblcaseresult has no numeric column, so this fails the run on the count check or not at all.
  assert.equal(count("tblcaseresult"), 3, "precondition: fixture is loaded");
  sql(`begin; set session_replication_role = replica; delete from tblcaseresult where rsltid = 123; commit;`);
  try {
    const r = verify();
    assert.equal(r.code, 1, "a missing row did not fail the run when no sum could catch it");
    assert.match(countRow(r.stdout, "tblcaseresult"), /\| 3 \| 2 \|.*\| \*\*MISMATCH\*\* \|$/);
    assert.equal(/\*\*MISMATCH\*\* \|$/m.test(r.stdout.split("## Numeric column sums")[1].split("##")[0]), false, "a sum was reported mismatched");
  } finally { reload(); }
});

test("a changed value exits 1 on the sum alone, with every row count still equal", () => {
  assert.equal(one(`select expamount::text from tblexpenses where expid = 91;`), "87.40", "precondition: fixture value is intact");
  sql(`update tblexpenses set expamount = expamount + 1 where expid = 91;`);
  try {
    const r = verify();
    assert.equal(r.code, 1, "an altered numeric value did not fail the run");
    assert.match(countRow(r.stdout, "tblexpenses"), /\| 3 \| 3 \|.*\| ok \|$/, "the count check fired instead of the sum check");
    assert.match(sumRow(r.stdout, "tblexpenses.expamount"), /\| 104\.45 \| 105\.45 \| \*\*MISMATCH\*\* \|$/);
  } finally { reload(); }
});

test("the report lands in scripts/migrate/out/ as verify-<timestamp>.md, byte-identical to stdout, and that path is gitignored", () => {
  const r = verify();
  assert.equal(r.code, 0, r.stderr);
  const path = r.stderr.match(/^wrote (.+)$/m)?.[1];
  assert.ok(path, `no written path on stderr: ${r.stderr}`);
  assert.equal(path, join(ROOT, "scripts/migrate/out", basename(path)), "the report did not land in scripts/migrate/out/");
  assert.match(basename(path), /^verify-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z\.md$/);
  assert.equal(readFileSync(path, "utf8"), r.stdout, "the file and stdout disagree");
  const ignored = execFileSync("git", ["-C", ROOT, "check-ignore", "-v", "scripts/migrate/out/" + basename(path)], { encoding: "utf8" });
  assert.match(ignored, /scripts\/migrate\/\.gitignore:\d+:out\//);
});

test("verify.mjs and parse.mjs are read-only: no DML, no DDL, no replication-role change", () => {
  for (const p of [VERIFY, PARSE]) {
    const code = readFileSync(p, "utf8").split("\n").filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join("\n");
    for (const [name, re] of [
      ["insert", /\binsert\s+into\b/i], ["update", /\bupdate\s+[a-z_"]/i], ["delete", /\bdelete\s+from\b/i],
      ["truncate", /\btruncate\b/i], ["alter", /\balter\s+[a-z]/i], ["drop", /\bdrop\s+[a-z]/i],
      ["create", /\bcreate\s+[a-z]/i], ["grant", /\bgrant\s+[a-z]/i], ["replica", /session_replication_role/i],
    ]) assert.equal(re.test(code), false, `${basename(p)} contains a ${name} statement`);
  }
});

test("the session timezone is pinned: the same load verifies identically under either operator TZ", () => {
  assert.equal(count("tblcase"), 3, "precondition: fixture is loaded");
  const strip = (s) => s.replace(/^# Migration verify — .*$/m, "");
  const utc = verify({ tz: "UTC" });
  const ny = verify({ tz: "America/New_York" });
  assert.equal(utc.code, 0, utc.stdout);
  assert.equal(ny.code, 0, ny.stdout);
  assert.equal(strip(ny.stdout), strip(utc.stdout), "the report changed with the operator's timezone");
  // And the mismatch verdict is TZ-independent too.
  sql(`update tblexpenses set expamount = expamount + 1 where expid = 91;`);
  try {
    assert.equal(verify({ tz: "America/New_York" }).code, 1, "a sum mismatch was missed under a non-UTC shell");
  } finally { reload(); }
});

test("it refuses to run without a source file", () => {
  const r = run(VERIFY, undefined);
  assert.equal(r.code, 2);
  assert.match(r.stderr, /usage: node scripts\/migrate\/verify\.mjs/);
});

test("a table missing from the export is EMPTY, not ok: 0 rows on both sides still exits 1", () => {
  // The whole point of criterion 1: a silently truncated mssql-scripter run must not verify clean.
  const trunc = exportWithout("tblcaseresult");
  try {
    const load = run(LOAD, trunc);
    assert.equal(load.code, 0, load.stderr);
    assert.equal(count("tblcaseresult"), 0, "precondition: the truncated export left the table empty");
    const r = verifyArgs(trunc);
    assert.equal(r.code, 1, "a table absent from the export verified clean");
    assert.match(countRow(r.stdout, "tblcaseresult"), /\| 0 \| 0 \|.*\| \*\*EMPTY — no INSERTs in export\*\* \|$/);
    // Every other table is unaffected — this fires on coverage, not on a count mismatch.
    assert.match(countRow(r.stdout, "tblexpenses"), /\| 3 \| 3 \|.*\| ok \|$/);
    assert.match(r.stdout, /^\*\*RESULT: FAILED — do not hand over\.\*\*$/m);
  } finally { reload(); }
});

test("--allow-empty acknowledges a genuinely empty table and lets the run pass", () => {
  const trunc = exportWithout("tblcaseresult");
  try {
    assert.equal(run(LOAD, trunc).code, 0);
    const r = verifyArgs(trunc, "--allow-empty=tblcaseresult");
    assert.equal(r.code, 0, r.stdout + r.stderr);
    assert.match(countRow(r.stdout, "tblcaseresult"), /\| 0 \| 0 \|.*\| ok \|$/);
  } finally { reload(); }
});

test("an identity sequence behind its table's max id exits 1", () => {
  assert.equal(verify().code, 0, "precondition: the load left sequences ahead");
  sql(`select setval(pg_get_serial_sequence('tblcase','caseid'), 1, true);`);
  try {
    const r = verify();
    assert.equal(r.code, 1, "a sequence behind max(id) verified clean — the app's next insert would collide");
    assert.match(r.stdout, /^\| tblcase \| 5010 \| 1 \| \*\*BEHIND — next insert collides\*\* \|$/m);
    // The row counts are all still equal; only the sequence section fails.
    assert.match(countRow(r.stdout, "tblcase"), /\| 3 \| 3 \|.*\| ok \|$/);
  } finally { reload(); }
});

test("a bad --allow-empty table name or an unknown flag exits 2 rather than verifying", () => {
  assert.equal(verifyArgs(SMALL, "--allow-empty=tblnope").code, 2, "an unknown table in --allow-empty was accepted");
  assert.equal(verifyArgs(SMALL, "--allow-everything").code, 2, "an unknown flag was accepted");
});

test("--allow-empty silences only the tables it names, never every empty table", () => {
  // Both tables must be 0-on-both-sides, or this passes on a plain count mismatch and proves nothing.
  const trunc = exportWithout("tblcaseresult", "tblbills");
  try {
    assert.equal(run(LOAD, trunc).code, 0);
    assert.equal(count("tblcaseresult"), 0, "precondition: both tables are empty in the db too");
    assert.equal(count("tblbills"), 0, "precondition: both tables are empty in the db too");
    const r = verifyArgs(trunc, "--allow-empty=tblcaseresult");
    assert.equal(r.code, 1, "--allow-empty for one table silenced a different empty table");
    assert.match(countRow(r.stdout, "tblcaseresult"), /\| 0 \| 0 \|.*\| ok \|$/, "the named table was not acknowledged");
    assert.match(countRow(r.stdout, "tblbills"), /\| 0 \| 0 \|.*\| \*\*EMPTY — no INSERTs in export\*\* \|$/, "the unnamed table was silenced");
  } finally { reload(); }
});
