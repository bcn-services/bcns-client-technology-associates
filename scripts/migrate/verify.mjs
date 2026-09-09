// scripts/migrate/verify.mjs — fidelity report for a load. READ-ONLY: it issues no DML/DDL.
// Usage: node scripts/migrate/verify.mjs <export.sql> (--source-counts=<file> | --no-source-counts)
//          [--allow-empty=tbl,tbl]                     (target from MIGRATE_DB_URL)
// Exit 0 = source and database agree on row counts and numeric sums, no legacy table is
// unexpectedly empty, and every identity sequence sits past its table's max id.
// Orphans under NOT VALID FKs and denormalized-column drift are informational and never fail.
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { decode, parse, quote } from "./parse.mjs";

// The 20 legacy tables, in dependency order (same list as load.mjs / README Part 1.5).
const TABLES = [
  "tblstates", "tblbranches", "tblcasestatus", "tblcasepriority", "tblcasewaitingfor",
  "tblbillingnames", "tblexptype", "tblfirm", "tblattorney", "tblclient",
  "tblinquiry", "tblcase", "tblbills", "tblactivity", "tblexpenses",
  "tblfundsrcvd", "tblsrvauth", "tblcaseresult", "tbl_scannedbillandcheck", "tblscanneddocument",
];

// ponytail: hand-curated set of text columns that were `ntext` in SQL Server. The export's
// N'...' literals do not distinguish ntext from nvarchar, and the Postgres schema stores both
// as `text`, so this list cannot be derived — re-check it if the legacy schema ever changes.
const NTEXT_COLS = [
  "tblcase.casenotes", "tblcase.casestatdescription", "tblcase.casestatbriefdescription", "tblcase.otherexperts",
  "tblinquiry.inqdescription", "tblinquiry.inqhowheardaboutus",
  "tblbills.billcomments",
  "tblexpenses.expclearingnotes", "tblexpenses.expreason",
  "tblfundsrcvd.fndscomment", "tblfundsrcvd.fndsclearingnotes",
  "tblsrvauth.srvauthnotes",
  "tblclient.clientnotes",
  "tbl_scannedbillandcheck.long_description",
];

const EXPECTED_NOT_VALID_FKS = 26; // ground truth from the schema review; reported, never fatal.

const args = process.argv.slice(2);
const flagVals = (name) => args.filter((a) => a.startsWith(`--${name}=`)).map((a) => a.slice(name.length + 3));
// A table the source genuinely has no rows for must be named here, so that "0 rows everywhere"
// is always a deliberate statement about the source and never a silently truncated export.
// With --source-counts this is rarely needed: a table SQL Server reports as 0 is acknowledged already.
const allowEmpty = new Set(flagVals("allow-empty").flatMap((v) => v.split(",")).map((s) => s.trim()).filter(Boolean));
const sourceCountsFile = flagVals("source-counts").at(-1);
const noSourceCounts = args.includes("--no-source-counts");
const KNOWN_FLAG = /^--(allow-empty=|source-counts=|no-source-counts$)/;
const unknownFlag = args.find((a) => a.startsWith("--") && !KNOWN_FLAG.test(a));
const positional = args.filter((a) => !a.startsWith("--"));
const file = positional[0];

// Comparing the database against the export alone cannot tell a faithful load from a truncated
// scripter run — both sides agree and both are wrong. So the source-of-truth counts are required,
// and skipping them has to be said out loud.
const argError =
  !file ? "no export file given"
  : positional.length > 1 ? `more than one export file given: ${positional.join(", ")}`
  : unknownFlag ? `unknown option ${unknownFlag}`
  : sourceCountsFile && noSourceCounts ? "--source-counts and --no-source-counts are mutually exclusive"
  : !sourceCountsFile && !noSourceCounts ? "refusing to run without SQL Server row counts: pass --source-counts=<file> (see README 1.2), or --no-source-counts to check the export only"
  : null;
if (argError) {
  process.stderr.write(`${argError}\nusage: node scripts/migrate/verify.mjs <export.sql> (--source-counts=<file> | --no-source-counts) [--allow-empty=tbl,tbl]\n`);
  process.exit(2);
}
const unknownAllowed = [...allowEmpty].filter((t) => !TABLES.includes(t));
if (unknownAllowed.length) {
  process.stderr.write(`--allow-empty names tables that are not legacy tables: ${unknownAllowed.join(", ")}\n`);
  process.exit(2);
}

// SQL Server's own counts, recorded in README 1.2 *before* the export was generated. Lines are
// `table|count` (sqlcmd -h -1 -W -s"|"); anything else in the file is ignored.
let srcTruth = null;
if (sourceCountsFile) {
  srcTruth = new Map();
  for (const line of readFileSync(sourceCountsFile, "utf8").split("\n")) {
    const [rawT, rawN] = line.split("|");
    if (rawN === undefined) continue;
    const tbl = rawT.trim(), n = rawN.trim();
    if (TABLES.includes(tbl) && /^\d+$/.test(n)) srcTruth.set(tbl, Number(n));
  }
  const missing = TABLES.filter((x) => !srcTruth.has(x));
  if (missing.length) {
    process.stderr.write(`${sourceCountsFile}: no row count for ${missing.join(", ")}\n`);
    process.exit(2);
  }
}

// MIGRATE_DB_URL is this lane's only env read; the harness derives DB_URL from FOUNDATION_PG_URL.
if (process.env.MIGRATE_DB_URL) process.env.FOUNDATION_PG_URL = process.env.MIGRATE_DB_URL;
const { DB_URL } = await import("../../tests/foundation/harness.mjs");

// Every psql session pins its timezone, exactly as the load does: a naive datetime2 in a
// timestamptz renders differently per shell TZ otherwise, and this report is compared run to run.
function q(text) {
  const out = execFileSync("psql", ["-X", "-q", "-v", "ON_ERROR_STOP=1", "-d", DB_URL, "-At", "-F", "\t"], {
    input: `set time zone 'UTC';\n${text}`, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"],
  });
  return out.split("\n").filter(Boolean).map((l) => l.split("\t"));
}

// --- exact decimal arithmetic (a float sum lies about money) ----------------
const SCALE = 12;
const POW = 10n ** BigInt(SCALE);
function dec(s) {
  const m = /^([+-]?)(\d*)(?:\.(\d*))?$/.exec(String(s).trim());
  if (!m || (!m[2] && !m[3])) throw new Error(`${file}: not a decimal: ${JSON.stringify(s)}`);
  const frac = m[3] ?? "";
  if (frac.length > SCALE) throw new Error(`${file}: more than ${SCALE} decimal places: ${s}`);
  return BigInt((m[1] === "-" ? "-" : "") + ((m[2] || "0") + frac.padEnd(SCALE, "0")));
}
function fmt(b) {
  const sign = b < 0n ? "-" : "";
  const a = b < 0n ? -b : b;
  const frac = (a % POW).toString().padStart(SCALE, "0").replace(/0+$/, "");
  return sign + (a / POW).toString() + (frac ? `.${frac}` : "");
}

// --- source side, from the export itself ------------------------------------
const stmts = parse(decode(readFileSync(file), file), file);
const known = new Set(TABLES);
const srcCount = new Map(TABLES.map((t) => [t, 0]));
const srcSum = new Map(); // "table.column" -> BigInt scaled by SCALE

const meta = q(`
select 'ident', table_name, column_name from information_schema.columns
  where table_schema = 'public' and is_identity = 'YES' and table_name in (${TABLES.map(quote).join(",")});
select 'num', table_name, column_name from information_schema.columns
  where table_schema = 'public' and data_type = 'numeric' and table_name in (${TABLES.map(quote).join(",")});
select 'seqname', table_name, pg_get_serial_sequence(table_name, column_name) from information_schema.columns
  where table_schema = 'public' and is_identity = 'YES' and table_name in (${TABLES.map(quote).join(",")});
select 'coltype', c.relname, a.attname, format_type(a.atttypid, a.atttypmod)
  from pg_attribute a
  join pg_class c on c.oid = a.attrelid
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and a.attnum > 0 and not a.attisdropped
    and c.relname in (${TABLES.map(quote).join(",")});
select 'fk', c.conname, tr.relname, a.attname, rr.relname, ra.attname
  from pg_constraint c
  join pg_class tr on tr.oid = c.conrelid
  join pg_class rr on rr.oid = c.confrelid
  join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
  join pg_attribute ra on ra.attrelid = c.confrelid and ra.attnum = c.confkey[1]
  where c.contype = 'f' and not c.convalidated
  order by 2;
`);
const identCol = new Map(meta.filter((r) => r[0] === "ident").map((r) => [r[1], r[2]]));
const colType = new Map(meta.filter((r) => r[0] === "coltype").map((r) => [`${r[1]}.${r[2]}`, r[3]]));
const seqName = new Map(meta.filter((r) => r[0] === "seqname" && r[2]).map((r) => [r[1], r[2]]));
const numCols = meta.filter((r) => r[0] === "num").map((r) => `${r[1]}.${r[2]}`);
const fks = meta.filter((r) => r[0] === "fk").map(([, conname, tbl, col, rtbl, rcol]) => ({ conname, tbl, col, rtbl, rcol }));
for (const k of numCols) srcSum.set(k, 0n);

for (const s of stmts) {
  if (!known.has(s.table)) continue; // load.mjs skips these too — it already reported them
  srcCount.set(s.table, srcCount.get(s.table) + s.rows.length);
  for (const [idx, c] of s.cols.entries()) {
    const key = `${s.table}.${c}`;
    if (!srcSum.has(key)) continue;
    for (const row of s.rows) if (row[idx].k !== "null") srcSum.set(key, srcSum.get(key) + dec(row[idx].v));
  }
}

// --- database side ----------------------------------------------------------
const dbQuery = [
  ...TABLES.map((t) => `select 'cnt', ${quote(t)}, count(*)::text from ${t};`),
  ...numCols.map((k) => `select 'sum', ${quote(k)}, coalesce(sum(${k.split(".")[1]}), 0)::text from ${k.split(".")[0]};`),
  // The five lookup tables have plain text PKs and no identity column — report '' / n/a, never a mismatch.
  ...TABLES.map((t) => (identCol.has(t)
    ? `select 'max', ${quote(t)}, coalesce(max(${identCol.get(t)})::text, '') from ${t};`
    : `select 'max', ${quote(t)}, '';`)),
  // Sequence position: setval(seq, max(id)) leaves last_value = max(id), so next insert is max+1.
  ...TABLES.map((t) => (seqName.has(t)
    ? `select 'seq', ${quote(t)}, last_value::text, is_called::text from ${seqName.get(t)};`
    : `select 'seq', ${quote(t)}, '', '';`)),
  ...NTEXT_COLS.map((k) => `select 'len', ${quote(k)}, coalesce(max(length(${k.split(".")[1]}))::text, '') from ${k.split(".")[0]};`),
  ...fks.map((f) => `select 'orphan', ${quote(f.conname)}, count(*)::text from ${f.tbl} t left join ${f.rtbl} r on t.${f.col} = r.${f.rcol} where t.${f.col} is not null and r.${f.rcol} is null;`),
  // A NULL counter is not evidence of drift — VBA simply never wrote one — so NULLs are skipped.
  `select 'drift', 'numunpaidbills', count(*)::text, coalesce(string_agg(caseid::text, ', ' order by caseid), '') from tblcase c
     where c.numunpaidbills is not null
       and c.numunpaidbills <> (select count(*) from tblbills b where b.billcaseid = c.caseid and b.billpaiddate is null);`,
  `select 'drift', 'numunapprovedsa', count(*)::text, coalesce(string_agg(caseid::text, ', ' order by caseid), '') from tblcase c
     where c.numunapprovedsa is not null
       and c.numunapprovedsa <> (select count(*) from tblsrvauth s where s.srvauthcaseid = c.caseid and s.srvauthstatus is distinct from 'Approved');`,
].join("\n");
const rows = q(dbQuery);
const pick = (tag) => new Map(rows.filter((r) => r[0] === tag).map((r) => [r[1], r.slice(2)]));
const dbCount = pick("cnt"), dbSum = pick("sum"), dbMax = pick("max"), dbLen = pick("len"), orphans = pick("orphan"), drift = pick("drift"), dbSeq = pick("seq");

// --- row-level comparison ---------------------------------------------------
// Counts and sums are many-to-one collapses. A note truncated mid-sentence, a NULL that became
// '', a date shifted by a day, two clients' names swapped, a case repointed at a different but
// still-existing client, or a cent moved from one expense to another all leave every count and
// every sum exactly as they were. This compares every cell of every row instead.
//
// The expected side casts the export's own literal straight to the column's type and lets
// Postgres decide equality. It deliberately does NOT reuse load.mjs's emit(): a bug inside
// emit() would then corrupt both sides identically and the comparison would pass on wrong data.
//
// EXCEPT ALL is an exact multiset comparison — it keeps duplicates and treats NULL as equal to
// NULL — so the two counts are "rows in the database that the export does not account for" and
// "rows in the export that are not in the database". A changed cell shows up as one of each.
function expected(val, type) {
  if (val.k === "null") return `cast(null as ${type})`;
  const lit = quote(val.v);
  // Access stores a time-only field as a full datetime on an epoch date it never shows the user.
  // Postgres will not cast that text straight to `time`, so go through timestamp — a different
  // route to the same value than load.mjs takes, which is exactly the point.
  if (type === "time without time zone" && /^\d{4}-\d\d-\d\dT/.test(val.v)) return `cast(cast(${lit} as timestamp) as time)`;
  // The export's datetime2 literals are naive wall-clock times. The load resolves them against
  // `America/New_York` (see the `set time zone` line in load.mjs and the Timezone note in the
  // README), while this report's own session is pinned to UTC, so say the zone explicitly here.
  // The value is repeated rather than shared because load.mjs is a CLI, not an importable module
  // — and it fails safe: if the two ever disagree, every dated row is reported as differing.
  if (type === "timestamp with time zone") return `(cast(${lit} as timestamp) at time zone 'America/New_York')`;
  return `cast(${lit} as ${type})`;
}

// mssql-scripter emits one INSERT per row, so gather each table's rows back together first.
const exportRows = new Map(); // table -> { cols, rows, colSets }
for (const s of stmts) {
  if (!known.has(s.table)) continue;
  const e = exportRows.get(s.table) ?? { cols: s.cols, rows: [], colSets: new Set() };
  e.colSets.add(s.cols.join(","));
  for (const row of s.rows) e.rows.push(row);
  exportRows.set(s.table, e);
}

let failedRowChk = false;
const rowChk = [];      // { t, missingInDb, extraInDb, note }
const droppedCols = []; // export columns with no counterpart in the Postgres schema
for (const t of TABLES) {
  const e = exportRows.get(t);
  if (!e || e.rows.length === 0) { rowChk.push({ t, note: "no rows in export" }); continue; }
  if (e.colSets.size > 1) { rowChk.push({ t, note: "**NOT COMPARED — the export uses more than one column list for this table**" }); failedRowChk = true; continue; }
  const keep = e.cols.map((c, i) => [c, i]).filter(([c]) => {
    if (colType.has(`${t}.${c}`)) return true;
    droppedCols.push(`${t}.${c}`);
    return false;
  });
  const colList = keep.map(([c]) => `"${c}"`).join(", ");
  const values = e.rows.map((row) => `(${keep.map(([c, i]) => expected(row[i], colType.get(`${t}.${c}`))).join(",")})`).join(",\n");
  const [, , extraInDb, missingInDb] = q(
    `with e(${colList}) as (values\n${values}\n)
     select 'rowchk', ${quote(t)},
       (select count(*) from (select ${colList} from ${t} except all table e) a)::text,
       (select count(*) from (table e except all select ${colList} from ${t}) b)::text;`,
  )[0];
  rowChk.push({ t, extraInDb: Number(extraInDb), missingInDb: Number(missingInDb), cols: keep.length });
}

// --- report -----------------------------------------------------------------
const md = [];
let failed = false;
const stamp = new Date().toISOString();
md.push(`# Migration verify — ${stamp}`, "", `Source: \`${file}\``, "");
// The header is the audit trail: an archived report has to show, on its face, what the run was
// allowed to overlook. A waiver that only lives in someone's shell history is not a waiver.
md.push(srcTruth
  ? `SQL Server row counts: \`${sourceCountsFile}\``
  : "SQL Server row counts: **not supplied** (`--no-source-counts`) — a partially truncated export cannot be detected from the export alone.");
if (allowEmpty.size) md.push("", `Acknowledged empty (\`--allow-empty\`): ${[...allowEmpty].map((x) => `\`${x}\``).join(", ")}.`);
md.push("");

md.push("## Row counts and identity maxima", "",
  `| table | ${srcTruth ? "sql server rows | " : ""}export rows | db rows | max identity | status |`,
  `| --- | ---: | ---: | ---: |${srcTruth ? " ---: |" : ""} --- |`);
for (const t of TABLES) {
  const src = srcCount.get(t), db = Number(dbCount.get(t)[0]);
  const truth = srcTruth ? srcTruth.get(t) : null;
  // Export vs db proves only that the load was faithful to the export. Whether the *export* was
  // faithful to SQL Server is a separate question, and only the source counts can answer it —
  // a truncated scripter run leaves both sides agreeing and both wrong.
  let status;
  if (truth !== null && truth !== src) status = `**TRUNCATED EXPORT — SQL Server has ${truth}**`;
  else if (src !== db) status = "**MISMATCH**";
  else if (src !== 0) status = "ok";
  else if (truth === 0) status = "ok (empty in SQL Server)";
  // No source counts: "0 rows everywhere" is indistinguishable from a truncated export using the
  // export alone, so it fails until someone says otherwise on the command line.
  else if (allowEmpty.has(t)) status = "ok (empty, acknowledged)";
  else status = "**EMPTY — no INSERTs in export**";
  if (status.startsWith("**")) failed = true;
  const max = identCol.has(t) ? (dbMax.get(t)[0] || "—") : "—";
  md.push(`| ${t} | ${truth !== null ? `${truth} | ` : ""}${src} | ${db} | ${max} | ${status} |`);
}

md.push("", srcTruth
  ? "A **TRUNCATED EXPORT** row means the export carries fewer rows than SQL Server holds: regenerate it (README 1.5), do not load it."
  : "An **EMPTY** table means the export contained no INSERT for it. Compare against `out/source-counts.txt` from README 1.2; if the table really is empty in SQL Server, re-run with `--allow-empty=<table>` — or better, pass `--source-counts=` and let this report do the comparison.");

md.push("", "## Identity sequence positions", "",
  "Each sequence's next value must clear its table's max id, or the first row the app inserts collides.",
  "", "| table | max identity | next sequence value | status |", "| --- | ---: | ---: | --- |");
for (const t of TABLES) {
  if (!identCol.has(t)) continue; // the five text-PK lookup tables have no sequence
  const max = dbMax.get(t)[0], [last, isCalled] = dbSeq.get(t);
  // last_value alone is ambiguous: setval(seq, n, false) parks last_value at n and hands out n
  // itself next, so is_called is what separates "n was consumed" from "n is next".
  const next = last === "" ? "" : (isCalled === "true" ? BigInt(last) + 1n : BigInt(last)).toString();
  if (max === "") { md.push(`| ${t} | — | ${next || "—"} | n/a (no rows) |`); continue; }
  const okSeq = next !== "" && BigInt(next) > BigInt(max);
  if (!okSeq) failed = true;
  md.push(`| ${t} | ${max} | ${next || "—"} | ${okSeq ? "ok" : "**BEHIND — next insert collides**"} |`);
}

md.push("", "## Numeric column sums", "", "| column | source sum | db sum | status |", "| --- | ---: | ---: | --- |");
for (const k of numCols) {
  const src = srcSum.get(k), db = dec(dbSum.get(k)[0]);
  const ok = src === db;
  if (!ok) failed = true;
  md.push(`| ${k} | ${fmt(src)} | ${fmt(db)} | ${ok ? "ok" : "**MISMATCH**"} |`);
}

md.push("", "## Row-level comparison (every cell of every row)", "",
  "Counts and sums cannot see a changed cell. This compares the export and the database as exact",
  "multisets of whole rows, so a truncated note, a swapped name, a shifted date, a flipped flag or",
  "a case repointed at the wrong client shows up as one row missing on each side.", "",
  "| table | columns compared | rows in export, not in db | rows in db, not in export | status |",
  "| --- | ---: | ---: | ---: | --- |");
for (const r of rowChk) {
  if (r.note) { md.push(`| ${r.t} | — | — | — | ${r.note} |`); continue; }
  const ok = r.missingInDb === 0 && r.extraInDb === 0;
  if (!ok) failed = true;
  md.push(`| ${r.t} | ${r.cols} | ${r.missingInDb} | ${r.extraInDb} | ${ok ? "ok" : "**ROWS DIFFER**"} |`);
}
if (failedRowChk) failed = true;
md.push("", droppedCols.length
  ? `**${droppedCols.length} export column(s) have no counterpart in the Postgres schema and were never loaded: ${droppedCols.join(", ")}.** They are excluded from the comparison above, so it cannot speak for them.`
  : "Every column the export carries exists in the Postgres schema, so no column is excluded from the comparison above.");

md.push("", `## Orphans under NOT VALID foreign keys (informational)`, "",
  `${fks.length} NOT VALID FK constraints found — expected ${EXPECTED_NOT_VALID_FKS}${fks.length === EXPECTED_NOT_VALID_FKS ? "" : " — **the schema has changed**"}.`,
  "", "| constraint | orphan rows |", "| --- | ---: |");
for (const f of fks) md.push(`| ${f.conname} (${f.tbl}.${f.col} → ${f.rtbl}.${f.rcol}) | ${orphans.get(f.conname)[0]} |`);

md.push("", "## Denormalized column drift (informational)", "",
  "VBA maintained these counters; NULL means it never wrote one and is not counted as drift.",
  "", "| column | cases disagreeing | case ids |", "| --- | ---: | --- |");
for (const [k, v] of drift) md.push(`| tblcase.${k} | ${v[0]} | ${v[1] || "—"} |`);

md.push("", "## Max length of ntext-derived text columns (informational)", "", "| column | max length |", "| --- | ---: |");
for (const k of NTEXT_COLS) md.push(`| ${k} | ${dbLen.get(k)[0] || "—"} |`);

md.push("", failed
  ? "**RESULT: FAILED — do not hand over.**"
  : "**RESULT: every row matches cell for cell; counts, sums, sequence positions and table coverage all check out.**", "");

const out = join(new URL(".", import.meta.url).pathname, "out");
mkdirSync(out, { recursive: true });
const path = join(out, `verify-${stamp.replace(/[:.]/g, "-")}.md`);
const text = md.join("\n");
writeFileSync(path, text);
process.stdout.write(text);
process.stderr.write(`\nwrote ${path}\n`);
process.exit(failed ? 1 : 0);
