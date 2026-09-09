// scripts/migrate/verify.mjs — fidelity report for a load. READ-ONLY: it issues no DML/DDL.
// Usage: node scripts/migrate/verify.mjs <export.sql>   (target from MIGRATE_DB_URL)
// Exit 0 = source and database agree on row counts and numeric sums.
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

const file = process.argv[2];
if (!file) {
  process.stderr.write("usage: node scripts/migrate/verify.mjs <export.sql>\n");
  process.exit(2);
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
const dbCount = pick("cnt"), dbSum = pick("sum"), dbMax = pick("max"), dbLen = pick("len"), orphans = pick("orphan"), drift = pick("drift");

// --- report -----------------------------------------------------------------
const md = [];
let failed = false;
const stamp = new Date().toISOString();
md.push(`# Migration verify — ${stamp}`, "", `Source: \`${file}\``, "");

md.push("## Row counts and identity maxima", "", "| table | source rows | db rows | max identity | status |", "| --- | ---: | ---: | ---: | --- |");
for (const t of TABLES) {
  const src = srcCount.get(t), db = Number(dbCount.get(t)[0]);
  const ok = src === db;
  if (!ok) failed = true;
  const max = identCol.has(t) ? (dbMax.get(t)[0] || "—") : "—";
  md.push(`| ${t} | ${src} | ${db} | ${max} | ${ok ? "ok" : "**MISMATCH**"} |`);
}

md.push("", "## Numeric column sums", "", "| column | source sum | db sum | status |", "| --- | ---: | ---: | --- |");
for (const k of numCols) {
  const src = srcSum.get(k), db = dec(dbSum.get(k)[0]);
  const ok = src === db;
  if (!ok) failed = true;
  md.push(`| ${k} | ${fmt(src)} | ${fmt(db)} | ${ok ? "ok" : "**MISMATCH**"} |`);
}

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

md.push("", failed ? "**RESULT: MISMATCH — do not hand over.**" : "**RESULT: counts and sums match.**", "");

const out = join(new URL(".", import.meta.url).pathname, "out");
mkdirSync(out, { recursive: true });
const path = join(out, `verify-${stamp.replace(/[:.]/g, "-")}.md`);
const text = md.join("\n");
writeFileSync(path, text);
process.stdout.write(text);
process.stderr.write(`\nwrote ${path}\n`);
process.exit(failed ? 1 : 0);
