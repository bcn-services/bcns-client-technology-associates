// tests/sync/export-gate.test.mjs — the pre-load gate in scripts/migrate/sync.sh: mssql-scripter exits 0
// when it fails, and load.mjs deletes every legacy table first, so an empty or partial export.sql must be
// refused by `verify.mjs --export-only` before any database write. No database is used: MIGRATE_DB_URL
// points at a dead port, so a run that reached for the database would fail differently.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ROOT = new URL("../..", import.meta.url).pathname;
const VERIFY = join(ROOT, "scripts/migrate/verify.mjs");
const SMALL = join(ROOT, "tests/migration/fixtures/export-small.sql"); // 3 rows in each of the 20 tables
const LEGACY_20 = [
  "tblstates", "tblbranches", "tblcasestatus", "tblcasepriority", "tblcasewaitingfor",
  "tblbillingnames", "tblexptype", "tblfirm", "tblattorney", "tblclient",
  "tblinquiry", "tblcase", "tblbills", "tblactivity", "tblexpenses",
  "tblfundsrcvd", "tblsrvauth", "tblcaseresult", "tbl_scannedbillandcheck", "tblscanneddocument",
];
const dir = mkdtempSync(join(tmpdir(), "export-gate-"));
const tmp = (name, body) => { const f = join(dir, name); writeFileSync(f, body); return f; };
const counts = (over = {}) => tmp("counts.txt", LEGACY_20.map((t) => `${t}|${over[t] ?? 3}`).join("\n") + "\n\n(20 rows affected)\n");
function gate(file, countsFile = counts()) {
  const r = spawnSync("node", [VERIFY, file, `--source-counts=${countsFile}`, "--export-only"], {
    encoding: "utf8", env: { ...process.env, MIGRATE_DB_URL: "postgresql://nobody:x@127.0.0.1:1/none" },
  });
  return { code: r.status, out: r.stdout, err: r.stderr };
}

test("a complete export passes and never touches the database", () => {
  const r = gate(SMALL);
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /all 20 tables match/);
});

test("an empty export.sql is rejected", () => {
  const r = gate(tmp("empty.sql", ""));
  assert.equal(r.code, 1);
  assert.match(r.err, /export incomplete/);
  assert.match(r.err, /tblcase has 0, SQL Server has 3/);
});

test("a truncated export (cut off mid-file) is rejected", () => {
  const full = readFileSync(SMALL, "utf8");
  const r = gate(tmp("cut.sql", full.slice(0, Math.floor(full.length / 2))));
  assert.equal(r.code, 1);
  assert.match(r.err, /export incomplete/);
});

test("an export missing whole tables is rejected and names them", () => {
  const kept = readFileSync(SMALL, "utf8").split("\n").filter((l) => !l.includes("[tblclient]") && !l.includes("[tblbills]"));
  const r = gate(tmp("missing.sql", kept.join("\n")));
  assert.equal(r.code, 1);
  assert.match(r.err, /tblclient has 0/);
  assert.match(r.err, /tblbills has 0/);
});

test("a row-count mismatch against SQL Server is rejected", () => {
  const r = gate(SMALL, counts({ tblfirm: 4 }));
  assert.equal(r.code, 1);
  assert.match(r.err, /tblfirm has 3, SQL Server has 4/);
});

test("sync.sh runs the gate before load.mjs", () => {
  const sh = readFileSync(join(ROOT, "scripts/migrate/sync.sh"), "utf8");
  const gateAt = sh.indexOf('node scripts/migrate/verify.mjs "$WORK/out/export.sql" --source-counts="$WORK/source-counts.txt" --export-only');
  const loadAt = sh.indexOf("node scripts/migrate/load.mjs");
  assert.ok(gateAt > 0 && loadAt > 0);
  assert.ok(gateAt < loadAt, "export gate must precede the load");
});
