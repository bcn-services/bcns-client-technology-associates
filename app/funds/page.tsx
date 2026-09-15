import Link from "next/link";
import { requireSession } from "@/lib/auth/session";
import { createServerClient } from "@/lib/db/client";
import type { Db } from "@/lib/time/entries";
import { fmtMoney } from "@/lib/bills/edit";
import { listRecentFunds } from "@/lib/funds/save";

export const dynamic = "force-dynamic";

/** Recent funds received, newest first. */
export default async function FundsListPage() {
  await requireSession();
  const rows = await listRecentFunds(createServerClient() as unknown as Db);
  return (
    <main className="mx-auto max-w-4xl space-y-4 px-4 py-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Funds received</h1>
        <Link href="/funds/new" className="rounded border border-slate-300 bg-slate-800 px-3 py-1 text-sm text-white hover:bg-slate-700">Record funds</Link>
      </div>
      {rows.length === 0 ? (
        <p className="text-sm text-slate-700">No funds recorded yet.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-slate-700">
                <th className="py-1 pr-3">Date</th><th className="py-1 pr-3">Case</th><th className="py-1 pr-3">Payee</th><th className="py-1 text-right">Amount</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.fndsid} className="border-b">
                  <td className="py-1 pr-3"><Link href={`/funds/${r.fndsid}`} className="underline">{r.fndsdate}</Link></td>
                  <td className="py-1 pr-3">{r.fndscaseid ?? ""}</td>
                  <td className="py-1 pr-3">{r.fndspayee ?? ""}</td>
                  <td className="py-1 text-right tabular-nums">{fmtMoney(r.fndspmt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}
