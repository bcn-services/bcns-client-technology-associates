/**
 * tests/cases/seed-fixtures.ts — upsert the invented foundation fixture rows
 * (tests/foundation/fixtures/rows.ts: firm 1, attorney Pat Example, client Sam Sample,
 * case 90001, …) into the Supabase project .env.local points at.
 * Usage: pnpm exec tsx tests/cases/seed-fixtures.ts
 *
 * Idempotent: rows upsert on their primary key; bank_transactions (identity ALWAYS,
 * no natural key) is inserted only when an identical row is absent. Afterwards every
 * identity sequence is moved to max(id) through DATABASE_URL, so app-created rows
 * don't collide with the explicit fixture ids. Invented data only.
 */
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { rows } from "../foundation/fixtures/rows";
import { loadEnvLocal } from "../app-shell/seed-e2e";
import { createServerClient } from "../../lib/db/client";

const PK: Record<string, string> = {
  tblstates: "state", tblbranches: "branch", tblcasestatus: "casestatus", tblcasepriority: "priority",
  tblcasewaitingfor: "waitingfor", tblbillingnames: "personid", tblexptype: "exptypeid", tblfirm: "frmid",
  tblattorney: "attyid", tblclient: "clientid", tblinquiry: "id", tblcase: "caseid", tblbills: "billid",
  tblactivity: "actid", tblexpenses: "expid", tblfundsrcvd: "fndsid", tblsrvauth: "srvauthid",
  tblcaseresult: "rsltid", tbl_scannedbillandcheck: "id_number", tblscanneddocument: "id",
};

const SYNC_SEQUENCES = `do $$ declare r record; begin
  for r in select table_name t, column_name c from information_schema.columns where table_schema='public' and is_identity='YES' loop
    execute format('select setval(pg_get_serial_sequence(%L,%L), greatest(coalesce((select max(%I) from %I),0),1))', r.t, r.c, r.c, r.t);
  end loop; end $$;`;

type Admin = ReturnType<typeof createServerClient>;

export async function seedFixtures(db: Admin): Promise<{ upserted: number; inserted: number; skipped: number }> {
  const loose = db as unknown as { from(t: string): any };
  let upserted = 0, inserted = 0, skipped = 0;
  for (const [table, row] of rows) {
    const pk = PK[table];
    if (pk) {
      const { error } = await loose.from(table).upsert(row, { onConflict: pk });
      if (error) throw new Error(`${table}: ${error.message}`);
      upserted++;
      continue;
    }
    const { data, error } = await loose.from(table).select("*").match(row).limit(1);
    if (error) throw new Error(`${table}: ${error.message}`);
    if (data.length) { skipped++; continue; }
    const ins = await loose.from(table).insert(row);
    if (ins.error) throw new Error(`${table}: ${ins.error.message}`);
    inserted++;
  }
  return { upserted, inserted, skipped };
}

/**
 * The priority tests need two tblcasepriority values; the fixtures seed one. Adds an invented
 * one only when fewer than two exist and returns its cleanup (a no-op when nothing was added).
 * Run the cleanup after restoring any case that points at it (tblcase FK).
 */
export async function ensureSecondPriority(db: Admin): Promise<() => Promise<void>> {
  const loose = db as unknown as { from(t: string): any };
  const temp = "Test Priority (temp)";
  // Self-heal a crashed earlier run: point 90001 back at High, then drop any leftover temp priority.
  const reset = await loose.from("tblcase").update({ casestatpriority: "High" }).eq("caseid", 90001).eq("casestatpriority", temp);
  if (reset.error) throw new Error(`tblcase reset: ${reset.error.message}`);
  const stale = await loose.from("tblcasepriority").delete().eq("priority", temp);
  if (stale.error) throw new Error(`tblcasepriority leftover: ${stale.error.message}`);
  const { data, error } = await loose.from("tblcasepriority").select("priority");
  if (error) throw new Error(`tblcasepriority: ${error.message}`);
  if (data.length >= 2) return async () => {};
  const ins = await loose.from("tblcasepriority").upsert({ priority: temp }, { onConflict: "priority" });
  if (ins.error) throw new Error(`tblcasepriority: ${ins.error.message}`);
  return async () => {
    const del = await loose.from("tblcasepriority").delete().eq("priority", temp);
    if (del.error) throw new Error(`tblcasepriority cleanup: ${del.error.message}`);
  };
}

/** Needs DATABASE_URL (PostgREST can't setval). Returns false when it isn't set. */
export function syncSequences(databaseUrl = process.env.DATABASE_URL): boolean {
  if (!databaseUrl) return false;
  execFileSync("psql", ["-X", "-q", "-v", "ON_ERROR_STOP=1", "-d", databaseUrl], { input: SYNC_SEQUENCES, stdio: ["pipe", "pipe", "pipe"] });
  return true;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  loadEnvLocal();
  // No top-level await: package.json has no "type": "module", so this file transpiles to CJS.
  Promise.resolve()
    .then(() => seedFixtures(createServerClient()))
    .then((r) => {
      const synced = syncSequences();
      process.stdout.write(`upserted ${r.upserted}, inserted ${r.inserted}, already present ${r.skipped}; sequences ${synced ? "synced" : "NOT synced (no DATABASE_URL)"}\n`);
    })
    .catch((err: Error) => {
      process.stderr.write(`${err.message}\n`);
      process.exit(1);
    });
}
