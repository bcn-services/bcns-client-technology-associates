import { requireSession } from "@/lib/auth/session";
import { createServerClient } from "@/lib/db/client";
import { onlyForbidden } from "@/lib/auth/users";
import { getConfig } from "@/lib/env";
import { syncState } from "@/lib/sync/runs";
import { SyncButton } from "./sync-button";

export const dynamic = "force-dynamic";

// The only color on the page: queued/running amber, succeeded green, failed red.
const BADGE: Record<string, string> = {
  queued: "bg-amber-100 text-amber-800",
  running: "bg-amber-100 text-amber-800",
  succeeded: "bg-emerald-100 text-emerald-800",
  failed: "bg-red-100 text-red-800",
};

const when = (t: string | null) =>
  t ? new Date(t).toLocaleString("en-US", { timeZone: "America/New_York", dateStyle: "medium", timeStyle: "short" }) : "—";

export default async function SyncPage() {
  if (!(await requireSession("admin").catch(onlyForbidden))) {
    return (
      <main className="mx-auto max-w-6xl space-y-2 px-4 py-6">
        <h1 className="text-xl font-semibold">Sync</h1>
        <p role="alert" className="text-sm text-red-700">Admins only.</p>
      </main>
    );
  }

  const db = createServerClient();
  const { last, canSync, reason } = await syncState(db, getConfig().githubSyncToken);
  let requester = "—";
  if (last?.requested_by) {
    const { data } = await db.from("profiles").select("email").eq("id", last.requested_by).maybeSingle();
    requester = data?.email ?? "—";
  }

  return (
    <main className="mx-auto max-w-6xl space-y-6 px-4 py-6">
      <h1 className="text-xl font-semibold">Sync</h1>
      {last && (
        <dl className="grid max-w-md grid-cols-[8rem_1fr] gap-y-1 text-sm">
          <dt className="text-slate-600">Status</dt>
          <dd>
            <span className={`rounded px-2 py-0.5 text-xs font-medium ${BADGE[last.status] ?? ""}`}>{last.status}</span>
          </dd>
          <dt className="text-slate-600">Backup</dt>
          <dd>{when(last.backup_at)}</dd>
          <dt className="text-slate-600">Requested</dt>
          <dd>{requester} · {when(last.requested_at)}</dd>
          <dt className="text-slate-600">Finished</dt>
          <dd>{when(last.finished_at)}</dd>
          {last.status === "failed" && last.error && (
            <>
              <dt className="text-slate-600">Error</dt>
              <dd>{last.error}</dd>
            </>
          )}
        </dl>
      )}
      <SyncButton canSync={canSync} reason={reason} />
    </main>
  );
}
