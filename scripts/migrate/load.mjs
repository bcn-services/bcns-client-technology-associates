// scripts/migrate/load.mjs — load a `mssql-scripter --data-only` script into Postgres.
// Usage: node scripts/migrate/load.mjs <export.sql>   (target from MIGRATE_DB_URL)
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { decode, parse, quote } from "./parse.mjs";

// The 20 legacy tables, in dependency order (same list as README Part 1.5).
// profiles / bank_transactions / audit_log are deliberately absent and must stay absent.
const TABLES = [
  "tblstates", "tblbranches", "tblcasestatus", "tblcasepriority", "tblcasewaitingfor",
  "tblbillingnames", "tblexptype", "tblfirm", "tblattorney", "tblclient",
  "tblinquiry", "tblcase", "tblbills", "tblactivity", "tblexpenses",
  "tblfundsrcvd", "tblsrvauth", "tblcaseresult", "tbl_scannedbillandcheck", "tblscanneddocument",
];

const file = process.argv[2];
if (!file) {
  process.stderr.write("usage: node scripts/migrate/load.mjs <export.sql>\n");
  process.exit(2);
}

// MIGRATE_DB_URL is this lane's only env read. The harness derives its DB_URL from
// FOUNDATION_PG_URL at import time, so point it at the same target before importing —
// that keeps the imported syncSequences() aimed at the database we just loaded.
if (process.env.MIGRATE_DB_URL) process.env.FOUNDATION_PG_URL = process.env.MIGRATE_DB_URL;
const { DB_URL, sql, errorOf, syncSequences } = await import("../../tests/foundation/harness.mjs");

const stmts = parse(decode(readFileSync(file), file), file);

/** The only value translations. No trimming, no defaulting, no clamping. */
function emit(val, dataType) {
  if (val.k === "null") return "NULL";
  if (val.k === "s") return quote(val.v);
  if (dataType === "boolean") { if (val.v === "1") return "true"; if (val.v === "0") return "false"; }
  return val.v;
}

// --- column types, read once ------------------------------------------------
const types = new Map(); // "table.column" -> { dataType, pgType }
for (const [t, c, dataType, prec, scale] of sql(
  `select table_name, column_name, data_type, coalesce(numeric_precision::text,''), coalesce(numeric_scale::text,'')
   from information_schema.columns
   where table_schema = 'public' and table_name in (${TABLES.map(quote).join(",")});`,
)) {
  types.set(`${t}.${c}`, { dataType, pgType: dataType === "numeric" && prec ? `numeric(${prec},${scale})` : dataType });
}

// --- build the load script --------------------------------------------------
const known = new Set(TABLES);
const skippedTables = new Map();
const skippedCols = new Map();
const counts = new Map(TABLES.map((t) => [t, 0]));
const lines = [];
const units = []; // one entry per emitted INSERT, parallel to its \echo marker

for (const s of stmts) {
  if (!known.has(s.table)) {
    skippedTables.set(s.table, (skippedTables.get(s.table) ?? 0) + s.rows.length);
    continue;
  }
  const keep = s.cols.map((c, idx) => [c, idx]).filter(([c]) => {
    if (types.has(`${s.table}.${c}`)) return true;
    skippedCols.set(`${s.table}.${c}`, true);
    return false;
  });
  const colSql = keep.map(([c]) => `"${c}"`).join(", ");
  for (const row of s.rows) {
    const cells = keep.map(([c, idx]) => ({ col: c, sql: emit(row[idx], types.get(`${s.table}.${c}`).dataType) }));
    // ponytail: one INSERT + one \echo marker per source row — that is what pins a failure to
    // an exact table.column. Batch the VALUES if a multi-million-row export ever gets slow.
    lines.push(`\\echo #${units.length}`);
    lines.push(`insert into ${s.table} (${colSql}) values (${cells.map((c) => c.sql).join(", ")});`);
    units.push({ table: s.table, cells });
    counts.set(s.table, counts.get(s.table) + 1);
  }
}

for (const [t, rows] of skippedTables) process.stderr.write(`skipped: table ${t} is not one of the 20 legacy tables (${rows} row(s))\n`);
for (const k of skippedCols.keys()) process.stderr.write(`skipped: column ${k} has no counterpart in the Postgres schema\n`);

const script = [
  "begin;",
  "set session_replication_role = replica;", // NOT VALID FKs and the audit triggers stay quiet, this session only
  // Pin the session timezone so a naive SQL Server datetime landing in a timestamptz column
  // resolves to the same instant on every machine and on go-live day. See README "Timezone".
  // Eastern, not UTC: Access wrote these as Eastern wall-clock times, and Kris reads them back
  // as the times he typed. Confirmed by Nate 2026-09-09. Changing this after go-live moves
  // every stored instant, so the go-live run must use the same value as every trial run.
  "set time zone 'America/New_York';",
  // Clear the 20 by name only. TRUNCATE is not usable here: profiles.personid and
  // bank_transactions.expid/fndsid reference three of them, so Postgres demands those
  // tables be named too (or CASCADE) — both forbidden. Under replica mode DELETE skips
  // the RI and audit triggers, so it clears the same rows and touches nothing else.
  // ponytail: row-level DELETE on a one-shot cutover load; revisit only if a table grows
  // past the point where a full DELETE + bloat is slower than the reload itself.
  ...[...TABLES].reverse().map((t) => `delete from ${t};`),
  ...lines,
  "commit;",
].join("\n") + "\n";

// --- run it in one psql session --------------------------------------------
try {
  execFileSync("psql", ["-X", "-q", "-v", "ON_ERROR_STOP=1", "-d", DB_URL], {
    input: script, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"],
  });
} catch (e) {
  const stderr = String(e.stderr ?? e.message);
  const pgError = (stderr.match(/^ERROR:.*/m) ?? [stderr.trim()])[0];
  const marks = String(e.stdout ?? "").match(/#\d+/g);
  const unit = marks ? units[Number(marks[marks.length - 1].slice(1))] : undefined;
  let where = unit ? unit.table : "load";
  if (unit) {
    for (const cell of unit.cells) {
      if (errorOf(`select cast(${cell.sql} as ${types.get(`${unit.table}.${cell.col}`).pgType});`)) {
        where = `${unit.table}.${cell.col}`;
        break;
      }
    }
  }
  process.stderr.write(`${where}: ${pgError}\nnothing was changed — the whole load ran in one transaction\n`);
  process.exit(1);
}

// setval() is non-transactional in Postgres, so this belongs after the commit either way.
syncSequences();

let total = 0;
for (const t of TABLES) { total += counts.get(t); process.stdout.write(`${t} ${counts.get(t)}\n`); }
process.stdout.write(`total ${total}\n`);
