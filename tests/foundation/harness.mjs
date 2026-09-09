// Shared harness for tests/foundation/*.test.mjs: rebuilds FOUNDATION_PG_URL from
// the stub + every migration, then runs SQL through psql (no pg driver dependency).
import { execFileSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { join } from "node:path";

export const DB_URL = process.env.FOUNDATION_PG_URL ?? "postgresql://localhost/ta_foundation";
const ADMIN_URL = DB_URL.replace(/\/[^/]*$/, "/postgres");
const DB_NAME = DB_URL.slice(DB_URL.lastIndexOf("/") + 1);
const ROOT = new URL("../..", import.meta.url).pathname;

function psql(url, args, input) {
  return execFileSync("psql", ["-X", "-q", "-v", "ON_ERROR_STOP=1", "-d", url, ...args], {
    input, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"],
  });
}

/** Run SQL, return rows as arrays of strings (tab-separated, unaligned). Throws on SQL error. */
export function sql(query) {
  const out = psql(DB_URL, ["-At", "-F", "\t"], query);
  return out.split("\n").filter(Boolean).map((l) => l.split("\t"));
}
export function one(query) { return sql(query)[0]?.[0]; }
/** Returns the error message instead of throwing; undefined when the statement succeeds. */
export function errorOf(query) {
  try { sql(query); return undefined; } catch (e) { return String(e.stderr ?? e.message); }
}

let built = false;
export function resetDb() {
  if (built) return;
  psql(ADMIN_URL, [], `drop database if exists ${DB_NAME}; create database ${DB_NAME};`);
  const stub = join(ROOT, "tests/foundation/local-supabase-stub.sql");
  psql(DB_URL, ["-f", stub]);
  const dir = join(ROOT, "supabase/migrations");
  for (const f of readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()) psql(DB_URL, ["-f", join(dir, f)]);
  built = true;
}

export function literal(v) {
  if (v === null || v === undefined) return "null";
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  return "'" + String(v).replace(/'/g, "''") + "'";
}
export function insertSql(table, row) {
  const cols = Object.keys(row);
  return `insert into ${table} (${cols.join(",")}) values (${cols.map((c) => literal(row[c])).join(",")});`;
}
/** After explicit-ID inserts, move every identity sequence past max(id) — lane migration must do the same after bulk load. */
export function syncSequences() {
  sql(`do $$ declare r record; begin
    for r in select table_name t, column_name c from information_schema.columns where table_schema='public' and is_identity='YES' loop
      execute format('select setval(pg_get_serial_sequence(%L,%L), greatest(coalesce((select max(%I) from %I),0),1))', r.t, r.c, r.c, r.t);
    end loop; end $$;`);
}
