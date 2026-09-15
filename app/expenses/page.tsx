import Link from "next/link";
import { requireSession } from "@/lib/auth/session";
import { createServerClient } from "@/lib/db/client";
import { firmToday } from "@/lib/cases/presets";
import type { Db } from "@/lib/time/entries";
import { listExpenses, parseCase, parseMonth } from "@/lib/expenses/list";

export const dynamic = "force-dynamic";

type Params = Record<string, string | string[] | undefined>;
const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

/** Read-only expense list. `?case=` alone → that case's whole ledger; otherwise `?month=yyyy-mm` (default: this month). */
export default async function ExpensesPage({ searchParams }: { searchParams: Params }) {
  const caseId = parseCase(first(searchParams.case));
  const month = parseMonth(first(searchParams.month)) ?? (caseId == null ? firmToday(new Date()).slice(0, 7) : null);
  // Session check and the read run together (saves the auth round trip); nothing renders unless requireSession resolves.
  const [, { rows, total }] = await Promise.all([requireSession(), listExpenses(createServerClient() as unknown as Db, { caseId, month })]);
  const title = [caseId != null && `case ${caseId}`, month].filter(Boolean).join(", ");
  return (
    <main className="mx-auto max-w-5xl space-y-4 px-4 py-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Expenses — {title}</h1>
        <Link href="/expenses/new" className="rounded border border-slate-300 bg-slate-800 px-3 py-1 text-sm text-white hover:bg-slate-700">Record expense</Link>
      </div>
      <form method="get" className="flex flex-wrap items-end gap-3 text-sm">
        <label className="flex flex-col">Case<input name="case" defaultValue={caseId ?? ""} inputMode="numeric" className="rounded border px-2 py-1" /></label>
        <label className="flex flex-col">Month<input name="month" type="month" defaultValue={month ?? ""} className="rounded border px-2 py-1" /></label>
        <button className="rounded border border-slate-300 px-3 py-1">Show</button>
      </form>
      <div className="overflow-x-auto">
        {/* Cell styles live on the table, not per cell: a month can be 5,000 rows and every attribute ships twice (HTML + RSC payload). */}
        <table className="w-full text-sm [&_a]:underline [&_td:nth-child(5)]:text-right [&_td:nth-child(5)]:tabular-nums [&_td]:py-1 [&_td]:pr-3 [&_th]:py-1 [&_th]:pr-3 [&_tr]:border-b">
          <thead>
            <tr className="text-left text-slate-700">
              <th>Date</th><th>Type</th><th>Description</th><th>Check #</th><th className="text-right">Amount</th><th>Cleared</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.expid}>
                <td><a href={`/expenses/${r.expid}`}>{r.expdate}</a></td>
                <td>{r.typeName}</td>
                <td>{r.expdscr}</td>
                <td>{r.expchecknum || ""}</td>
                <td>{r.amount}</td>
                <td>{r.expclearedbank ? "Yes" : ""}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="font-semibold">
              <td colSpan={4}>Total ({rows.length} {rows.length === 1 ? "expense" : "expenses"})</td>
              <td className="text-right tabular-nums" data-testid="expense-total">{total}</td>
              <td />
            </tr>
          </tfoot>
        </table>
      </div>
    </main>
  );
}
