import Link from "next/link";
import type { SearchResult } from "@/lib/cases/search";

/** Shared result/list table. `titlesOnly` renders the legacy title-only list. */
export function ResultsTable({ result, titlesOnly = false, empty }: { result: SearchResult; titlesOnly?: boolean; empty: string }) {
  if ("error" in result) {
    return <p role="alert" className="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{result.error}</p>;
  }
  if (!result.rows.length) return <p className="text-sm text-slate-600">{empty}</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm" data-testid="case-results">
        <thead className="border-b border-slate-200 text-slate-600">
          <tr>
            <th className="py-2 pr-3">Case #</th>
            <th className="py-2 pr-3">Title</th>
            {!titlesOnly && (
              <>
                <th className="py-2 pr-3">Status</th>
                <th className="py-2 pr-3">Start date</th>
                <th className="py-2 pr-3">Attorney</th>
                <th className="py-2 pr-3">Firm</th>
                <th className="py-2 pr-3">Client</th>
              </>
            )}
            <th className="py-2">Label</th>
          </tr>
        </thead>
        <tbody>
          {result.rows.map((r) => (
            <tr key={r.caseid} data-case-id={r.caseid} className="border-b border-slate-100 align-top">
              <td className="py-2 pr-3">
                <Link href={`/cases/${r.caseid}`} className="text-blue-700 hover:underline">{r.caseid}</Link>
              </td>
              <td className="py-2 pr-3">{r.casetitle}</td>
              {!titlesOnly && (
                <>
                  <td className="py-2 pr-3">{r.status}</td>
                  <td className="py-2 pr-3">{r.casestartdate}</td>
                  <td className="py-2 pr-3">{r.attyname}</td>
                  <td className="py-2 pr-3">{r.frmname}</td>
                  <td className="py-2 pr-3">{r.clientname}</td>
                </>
              )}
              <td className="py-2">
                <Link href={`/cases/${r.caseid}/label`} className="text-blue-700 hover:underline">Label</Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {result.more && <p className="mt-2 text-sm text-slate-600">More results exist — narrow the search to see them.</p>}
    </div>
  );
}
