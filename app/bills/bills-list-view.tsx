import Link from "next/link";
import type { BillGroup } from "@/lib/bills/list";

/** Read-only list of open bills by stage. No forms, no actions. */
export function BillsListView({ groups }: { groups: BillGroup[] }) {
  if (groups.every((g) => g.rows.length === 0)) return <p className="text-sm text-gray-600">No open bills.</p>;
  return (
    <div className="space-y-6">
      {groups.filter((g) => g.rows.length > 0).map((g) => (
        <section key={g.stage} data-stage={g.stage} className="space-y-2">
          <h2 className="text-lg font-semibold">{g.stage}</h2>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-gray-600">
                <th className="py-1">Case</th><th>Bill</th><th>Bill date</th><th className="text-right">Balance</th><th className="text-right">Since notice</th><th></th>
              </tr>
            </thead>
            <tbody>
              {g.rows.map((r) => (
                <tr key={r.billid} data-testid="open-bill" className="border-t">
                  <td className="py-1"><Link href={`/cases/${r.caseNumber}`} className="text-blue-700 hover:underline">{r.caseNumber}</Link></td>
                  <td><Link href={`/bills/${r.billid}`} className="text-blue-700 hover:underline">{r.filename ?? `Bill #${r.billid}`}</Link></td>
                  <td>{r.billdate}</td>
                  <td className="text-right">{r.balance.toFixed(2)}</td>
                  <td className="text-right">{r.days} days</td>
                  <td>{r.due ? <span data-testid="due-badge" className="rounded bg-red-100 px-2 text-xs font-medium text-red-800">due</span> : null}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ))}
    </div>
  );
}
