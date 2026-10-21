/**
 * "Sync from Access" requests. Server-only: callers pass the service-role client, the GitHub
 * token and fetch in, so tests inject fakes (mirrors lib/auth/users.ts). The workflow itself
 * (.github/workflows/sync-legacy.yml -> scripts/migrate/sync.sh) is what overwrites the legacy
 * tables; this module only queues a sync_runs row and dispatches that workflow.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/db/client";

type Db = SupabaseClient<Database>;
export type SyncRun = Database["public"]["Tables"]["sync_runs"]["Row"];
export type SyncResult = { ok: true; message: string } | { ok: false; error: string };
export type SyncState = { last: SyncRun | null; active: boolean; canSync: boolean; reason?: string };

export const DISPATCH_URL =
  "https://api.github.com/repos/bcn-services/bcns-client-technology-associates/actions/workflows/sync-legacy.yml/dispatches";
/** A running row started longer ago than this is presumed dead (the workflow's own timeout is 2h). */
export const STALE_MS = 3 * 60 * 60 * 1000;
/** A row still queued (never started) this long after it was requested means the dispatch never ran. */
export const STALE_QUEUED_MS = 30 * 60 * 1000;

const NOT_CONFIGURED = "Not configured";
const refuse = (error: string): SyncResult => ({ ok: false, error });
const isActive = (r: SyncRun | null): r is SyncRun => r?.status === "queued" || r?.status === "running";
// Measured from started_at, not requested_at: a run that waited in GitHub's queue is not dead. A row that
// never started is stale on the much shorter queue clock.
const isStale = (r: SyncRun, now: number) =>
  r.started_at ? now - Date.parse(r.started_at) > STALE_MS : now - Date.parse(r.requested_at) > STALE_QUEUED_MS;

/** Newest run. At most one row can be queued/running (partial unique index), and it is always the newest. */
async function latestRun(db: Db): Promise<SyncRun | null> {
  const { data, error } = await db.from("sync_runs").select("*").order("id", { ascending: false }).limit(1);
  if (error) throw new Error(`sync_runs: ${error.message}`);
  return data?.[0] ?? null;
}

async function markFailed(db: Db, id: number, error: string, now: number): Promise<void> {
  // Only a still-active row: a run that finished between our read and this write must keep its real outcome.
  await db
    .from("sync_runs")
    .update({ status: "failed", error, finished_at: new Date(now).toISOString() })
    .eq("id", id)
    .in("status", ["queued", "running"]);
}

export async function syncState(db: Db, token: string | undefined, now: number = Date.now()): Promise<SyncState> {
  const last = await latestRun(db);
  // A stale active row does not block: requestSync reclaims it.
  const active = isActive(last) && !isStale(last, now);
  if (!token) return { last, active, canSync: false, reason: NOT_CONFIGURED };
  if (active) return { last, active, canSync: false, reason: "A sync is running" };
  return { last, active, canSync: true };
}

export async function requestSync(
  db: Db,
  actorId: string | null | undefined,
  token: string | undefined,
  fetchImpl: typeof fetch = fetch,
  now: number = Date.now(),
): Promise<SyncResult> {
  if (!token) return refuse(NOT_CONFIGURED);
  if (!actorId) return refuse("Missing account id — nothing was started.");

  const last = await latestRun(db);
  if (isActive(last)) {
    if (!isStale(last, now)) return refuse("A sync is already running");
    await markFailed(db, last.id, "timed out", now);
  }

  const { data: row, error } = await db.from("sync_runs").insert({ requested_by: actorId }).select("*").single();
  if (error || !row) {
    // 23505 = the one-active-run unique index: someone else queued between our read and insert.
    return refuse(error?.code === "23505" ? "A sync is already running" : "Could not start the sync.");
  }

  // Never put the token (or the response body) in a message: the string below is stored and shown.
  let status: number | null = null;
  try {
    const res = await fetchImpl(DISPATCH_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
      body: JSON.stringify({ ref: "main", inputs: { run_id: String(row.id) } }),
    });
    status = res.status;
  } catch {
    /* status stays null */
  }
  if (status !== 204) {
    await markFailed(db, row.id, `dispatch failed (${status === null ? "network error" : `HTTP ${status}`})`, now);
    return refuse("Could not start the sync — the dispatch failed.");
  }
  return { ok: true, message: "Sync queued." };
}
