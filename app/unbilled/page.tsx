import { requireSession } from "@/lib/auth/session";
import { createServerClient } from "@/lib/db/client";
import type { Db } from "@/lib/time/entries";
import { loadUnbilled } from "@/lib/reports/unbilled";

export const dynamic = "force-dynamic";

const table = "w-full text-sm [&_a]:underline [&_td]:py-1 [&_td]:pr-3 [&_th]:py-1 [&_th]:pr-3 [&_tr]:border-b";
const caseLink = (id: number) => <a href={`/cases/${id}`}>{id}</a>;

/** Read-only list of the logged time entries and expenses on cases that no bill has claimed yet (the dashboard's Unbilled tile). */
export default async function UnbilledPage() {
  const [, { time, expenses }] = await Promise.all([requireSession(), loadUnbilled(createServerClient() as unknown as Db)]);
  return (
    <main className="mx-auto max-w-5xl space-y-6 px-4 py-6">
      <h1 className="text-xl font-semibold">Unbilled work</h1>
      <section className="space-y-2">
        <h2 className="text-lg font-semibold">Time entries ({time.length})</h2>
        {!time.length ? <p className="text-sm text-slate-600">No unbilled time.</p> : (
          <table className={table} data-testid="unbilled-time">
            <thead><tr className="text-left text-slate-700"><th>Case #</th><th>Date</th><th>Description</th><th>Hours</th></tr></thead>
            <tbody>
              {time.map((r) => (
                <tr key={r.actid}><td>{caseLink(r.actcaseid)}</td><td>{String(r.actdate).slice(0, 10)}</td><td>{r.actdescription}</td><td>{r.acthrs}</td></tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
      <section className="space-y-2">
        <h2 className="text-lg font-semibold">Expenses ({expenses.length})</h2>
        {!expenses.length ? <p className="text-sm text-slate-600">No unbilled expenses.</p> : (
          <table className={table} data-testid="unbilled-expenses">
            <thead><tr className="text-left text-slate-700"><th>Case #</th><th>Date</th><th>Description</th><th>Amount</th></tr></thead>
            <tbody>
              {expenses.map((r) => (
                <tr key={r.expid}><td>{caseLink(r.expcaseid)}</td><td><a href={`/expenses/${r.expid}`}>{String(r.expdate).slice(0, 10)}</a></td><td>{r.expdscr}</td><td>{Number(r.expamount).toFixed(2)}</td></tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </main>
  );
}
