import Link from "next/link";
import { createServerClient } from "@/lib/db/client";
import type { Db } from "@/lib/time/entries";
import { listCaseFunds, type CaseFunds } from "@/lib/funds/case";

// Case-page selector traps: exactly one heading matching /funds received/i (journey 01); no buttons, no labelled inputs.

/** Loads the case's funds; a failed read renders a note instead of breaking the case page. */
export async function CaseFundsPanel({ caseId, db }: { caseId: number; db?: Db }) {
  const d = db ?? (createServerClient() as unknown as Db);
  const funds = await listCaseFunds(d, caseId).catch((e) => { console.error("case funds read:", e); return null; });
  return <CaseFundsView caseId={caseId} funds={funds} />;
}

export function CaseFundsView({ caseId, funds }: { caseId: number; funds: CaseFunds | null }) {
  return (
    <section id="funds-panel" data-testid="funds-panel" aria-labelledby="funds-panel-h" className="space-y-2 rounded border border-slate-200 p-3">
      <h2 id="funds-panel-h" className="font-semibold">Funds received</h2>
      {funds == null ? (
        <p className="text-sm text-red-700">Funds could not be loaded.</p>
      ) : funds.rows.length === 0 ? (
        <p className="text-sm text-slate-500">No funds on this case</p>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-slate-500">
              <th className="py-1 font-normal">Date</th><th className="font-normal">Type / payee</th>
              <th className="text-right font-normal">Amount</th><th className="pl-3 font-normal">Cleared</th>
            </tr>
          </thead>
          <tbody>
            {funds.rows.map((r) => (
              <tr key={r.fndsid} data-testid="case-funds" className="border-t border-slate-100">
                <td className="py-1"><Link href={`/funds/${r.fndsid}`} className="underline">{r.fndsdate}</Link></td>
                <td>{[r.fndstype, r.fndspayee].filter(Boolean).join(" / ")}</td>
                <td className="text-right tabular-nums">{r.amount}</td>
                <td className="pl-3">{r.cleared ? "Cleared" : ""}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t border-slate-300 font-medium">
              <td colSpan={2} className="py-1">Total</td>
              <td data-testid="funds-total" className="text-right tabular-nums">{funds.total}</td><td />
            </tr>
          </tfoot>
        </table>
      )}
      <Link href={`/funds/new?case=${caseId}`} className="text-sm underline">Add funds</Link>
    </section>
  );
}
