import { requireSession } from "@/lib/auth/session";
import { createServerClient } from "@/lib/db/client";
import type { Db } from "@/lib/time/entries";
import { loadUnbilled } from "@/lib/reports/unbilled";

export const dynamic = "force-dynamic";

const table = "w-full text-sm [&_a]:underline [&_td]:py-1 [&_td]:pr-3 [&_th]:py-1 [&_th]:pr-3 [&_tr]:border-b";

/** Read-only list of the logged time entries that no bill has claimed yet (the dashboard's Unbilled tile). Expenses are not listed; see lib/reports/unbilled. */
export default async function UnbilledPage() {
  const [, { time }] = await Promise.all([requireSession(), loadUnbilled(createServerClient() as unknown as Db)]);
  return (
    <main className="mx-auto max-w-5xl space-y-4 px-4 py-6">
      <h1 className="text-xl font-semibold">Unbilled time ({time.length})</h1>
      {!time.length ? <p className="text-sm text-slate-600">No unbilled time.</p> : (
        <table className={table} data-testid="unbilled-time">
          <thead><tr className="text-left text-slate-700"><th>Case #</th><th>Date</th><th>Description</th><th>Hours</th></tr></thead>
          <tbody>
            {time.map((r) => (
              <tr key={r.actid}><td><a href={`/cases/${r.actcaseid}`}>{r.actcaseid}</a></td><td>{String(r.actdate).slice(0, 10)}</td><td>{r.actdescription}</td><td>{r.acthrs}</td></tr>
            ))}
          </tbody>
        </table>
      )}
    </main>
  );
}
