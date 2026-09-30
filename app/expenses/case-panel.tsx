import Link from "next/link";
import { createServerClient } from "@/lib/db/client";
import type { Db } from "@/lib/time/entries";
import { listExpenses, type ExpenseList } from "@/lib/expenses/list";

// Case-page selector traps: exactly one heading matching /expenses/i (journey 01); no buttons, no labelled inputs.

/** Loads the case's expenses (listExpenses, case filter only); a failed read renders a note instead. */
export async function CaseExpensesPanel({ caseId, db }: { caseId: number; db?: Db }) {
  const d = db ?? (createServerClient() as unknown as Db);
  const list = await listExpenses(d, { caseId, month: null }).catch((e) => { console.error("case expenses read:", e); return null; });
  return <CaseExpensesView caseId={caseId} list={list} />;
}

export function CaseExpensesView({ caseId, list }: { caseId: number; list: ExpenseList | null }) {
  return (
    <section id="expenses-panel" data-testid="expenses-panel" aria-labelledby="expenses-panel-h" className="space-y-2 rounded border border-slate-200 p-3">
      <h2 id="expenses-panel-h" className="font-semibold">Expenses</h2>
      {list == null ? (
        <p className="text-sm text-red-700">Expenses could not be loaded.</p>
      ) : list.rows.length === 0 ? (
        <p className="text-sm text-slate-500">No expenses on this case</p>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-slate-500">
              <th className="py-1 font-normal">Date</th><th className="font-normal">Type / payee</th>
              <th className="text-right font-normal">Amount</th><th className="pl-3 font-normal">Cleared</th>
            </tr>
          </thead>
          <tbody>
            {list.rows.map((r) => (
              <tr key={r.expid} data-testid="case-expense" className="border-t border-slate-100">
                <td className="py-1"><Link href={`/expenses/${r.expid}`} className="underline">{r.expdate}</Link></td>
                <td>{[r.typeName, r.expdscr].filter(Boolean).join(" / ")}</td>
                <td className="text-right tabular-nums">{r.amount}</td>
                <td className="pl-3">{r.expclearedbank === true ? "Cleared" : ""}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t border-slate-300 font-medium">
              <td colSpan={2} className="py-1">Total</td>
              <td data-testid="expenses-total" className="text-right tabular-nums">{list.total}</td><td />
            </tr>
          </tfoot>
        </table>
      )}
      <Link href={`/expenses/new?case=${caseId}`} className="text-sm underline">Add expense</Link>
    </section>
  );
}
