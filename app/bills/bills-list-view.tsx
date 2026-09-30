import Link from "next/link";
import type { BillGroup } from "@/lib/bills/list";
import { sendErrorMessage } from "@/lib/bills/send-messages";

/**
 * Open bills by stage. No forms, no actions: a typed bill shows its state (Draft / Finalized / Sent <date>) and a PDF
 * link when one is stored; for admins a row links to Finalize / Send and a 2nd / Final row to its Send notice preview,
 * or says why it can't (no stored PDF). Legacy rows render exactly as before item 8.
 */
export function BillsListView({ groups, admin = false }: { groups: BillGroup[]; admin?: boolean }) {
  if (groups.every((g) => g.rows.length === 0)) return <p className="text-sm text-gray-600">No open bills.</p>;
  return (
    <div className="space-y-6">
      {groups.filter((g) => g.rows.length > 0).map((g) => (
        <section key={g.stage} data-stage={g.stage} className="space-y-2">
          <h2 className="text-lg font-semibold">{g.stage}</h2>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-gray-600">
                <th className="py-1">Case</th><th>Bill</th><th>Bill date</th><th className="text-right">Balance</th><th className="text-right">Since notice</th><th></th>{admin && <th></th>}
              </tr>
            </thead>
            <tbody>
              {g.rows.map((r) => (
                <tr key={r.billid} data-testid="open-bill" className="border-t">
                  <td className="py-1"><Link href={`/cases/${r.caseNumber}`} className="text-blue-700 hover:underline">{r.caseNumber}</Link></td>
                  <td>
                    <Link href={`/bills/${r.billid}`} className="text-blue-700 hover:underline">{r.filename ?? `Bill #${r.billid}`}</Link>
                    {r.output && <span data-testid="bill-state" className="ml-2 text-xs text-gray-600">{r.output.state}</span>}
                    {r.output?.download && <a href={`/bills/${r.billid}/pdf`} data-testid="bill-download" className="ml-2 text-xs text-blue-700 hover:underline">Download PDF</a>}
                  </td>
                  <td>{r.billdate}</td>
                  <td className="text-right">{r.balance.toFixed(2)}</td>
                  <td className="text-right">{r.days} days</td>
                  <td>{r.due ? <span data-testid="due-badge" className="rounded bg-red-100 px-2 text-xs font-medium text-red-800">due</span> : null}</td>
                  {admin && (
                    <td>
                      {r.output?.finalize && <Link href={`/bills/${r.billid}/finalize`} data-testid="bill-finalize" className="mr-2 text-blue-700 hover:underline">Finalize</Link>}
                      {r.output?.send && <Link href={`/bills/${r.billid}/send${r.output.sent ? "?again=1" : ""}`} data-testid="bill-send" className="mr-2 text-blue-700 hover:underline">{r.output.sent ? "Send again" : "Send"}</Link>}
                      {r.sendNotice ? <Link href={`/bills/${r.billid}/notice`} data-testid="send-notice" className="text-blue-700 hover:underline">Send notice</Link>
                        : r.noticeWhy ? <span data-testid="notice-blocked" title={sendErrorMessage(r.noticeWhy)} className="text-xs text-gray-500">No stored PDF</span> : null}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ))}
    </div>
  );
}
