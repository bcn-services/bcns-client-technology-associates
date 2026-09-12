import Link from "next/link";
import type { ReactNode } from "react";

export function ErrorNote({ message }: { message: string }) {
  return <p role="alert" className="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{message}</p>;
}

export function CaseLink({ id }: { id: number }) {
  return <Link href={`/cases/${id}`} className="text-blue-700 hover:underline">{id}</Link>;
}

/** Plain table: header labels + rows of cells. */
export function Table({ head, rows, testId }: { head: string[]; rows: { key: string | number; cells: ReactNode[] }[]; testId: string }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm" data-testid={testId}>
        <thead className="border-b border-slate-200 text-slate-600">
          <tr>{head.map((h) => <th key={h} className="py-2 pr-3">{h}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.key} className="border-b border-slate-100 align-top">
              {r.cells.map((c, i) => <td key={i} className="py-2 pr-3">{c}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function Back() {
  return <Link href="/cases/lists" className="text-sm text-blue-700 hover:underline print:hidden">All case lists</Link>;
}
