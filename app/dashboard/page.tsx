import Link from "next/link";
import { requireSession } from "@/lib/auth/session";
import { createServerClient } from "@/lib/db/client";
import type { Db } from "@/lib/time/entries";
import { loadDashboard } from "@/lib/reports/dashboard";

export const dynamic = "force-dynamic";

// House table classes (app/expenses/page.tsx:31-58).
const table = "w-full text-sm [&_a]:underline [&_td]:py-1 [&_td]:pr-3 [&_th]:py-1 [&_th]:pr-3 [&_tr]:border-b";

/**
 * Read-only dashboard: four count tiles over the Work Status Sheet. Column headings deliberately avoid the
 * words the tiles use, so each tile label stays the only element carrying its word.
 */
export default async function DashboardPage() {
  // Session check and the read run together (saves the auth round trip); nothing renders unless requireSession resolves.
  const [, data] = await Promise.all([
    requireSession(),
    loadDashboard(createServerClient() as unknown as Db, new Date()),
  ]);

  return (
    <main className="mx-auto max-w-6xl space-y-4 px-4 py-6">
      <h1 className="text-xl font-semibold">Dashboard</h1>
      <div data-testid="dashboard-tiles" className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {data.tiles.map((t) => (
          <Link key={t.key} href={t.href} className="rounded border border-slate-200 bg-white p-4 hover:bg-slate-50">
            <span className="block text-2xl font-semibold tabular-nums" data-testid={`tile-${t.key}`}>{t.count ?? "—"}</span>
            <span className="block text-sm text-slate-700">{t.label}</span>
          </Link>
        ))}
      </div>

      <h2 className="text-lg font-semibold">Work Status</h2>
      {data.error ? <p role="alert" className="text-sm text-red-700">{data.error}</p>
        : !data.rows.length ? <p className="text-sm text-slate-600">No open work on the sheet.</p>
        : (
          <div className="overflow-x-auto">
            <table className={table} data-testid="dashboard-work-status">
              <thead>
                <tr className="text-left text-slate-700">
                  <th>Case #</th><th>Title</th><th>Priority</th><th>Point man</th><th>Description</th>
                </tr>
              </thead>
              <tbody>
                {data.rows.map((r) => (
                  <tr key={r.caseid}>
                    <td><a href={`/cases/${r.caseid}`}>{r.caseid}</a></td>
                    <td>{r.casetitle}</td>
                    <td>{r.casestatpriority ?? ""}</td>
                    <td>{r.casestatpointman ?? ""}</td>
                    <td>{r.casestatdescription ?? ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
    </main>
  );
}
