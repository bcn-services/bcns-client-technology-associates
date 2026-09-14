import Link from "next/link";
import { BillLink } from "@/app/bills/bill-link";
import { createServerClient } from "@/lib/db/client";
import type { Db } from "@/lib/time/entries";
import { listCaseTime, unbilledHours, type CaseTimeRow } from "@/lib/time/case";
import { fmtHours, isBilled, thousandths } from "@/lib/time/week";

// Case-page selector traps: no text matching /bills/i (journey 01), /firm|attorney|client/i (journey 02),
// no buttons and no labelled inputs (tests/cases). Reads only.

/** Loads the case's time rows; a failed read renders a note instead of breaking the case page. */
export async function TimePanel({ caseId, db }: { caseId: number; db?: Db }) {
  const d = db ?? (createServerClient() as unknown as Db);
  const rows = await listCaseTime(d, caseId).catch((e) => { console.error("case time read:", e); return null; });
  return <TimePanelView caseId={caseId} rows={rows} />;
}

export function TimePanelView({ caseId, rows }: { caseId: number; rows: CaseTimeRow[] | null }) {
  const href = `/time?case=${caseId}`;
  return (
    <section id="time-panel" data-testid="time-panel" className="space-y-2 rounded border border-slate-200 p-3">
      <h2 className="font-semibold">Time</h2>
      {rows == null ? (
        <p className="text-sm text-red-700">Time entries could not be loaded.</p>
      ) : (
        <>
          {rows.length === 0 ? (
            <p className="text-sm text-slate-500">No time entries</p>
          ) : (
            <ul className="divide-y divide-slate-100 text-sm">
              {rows.map((r) => (
                <li key={r.actid} data-testid="time-row" className="flex flex-wrap gap-x-2 py-1">
                  <span className="text-slate-500">{r.actdate}</span>{" "}
                  <span className="font-medium">{r.initials}</span>{" "}
                  <span className="tabular-nums">{fmtHours(thousandths(r.acthrs))}</span>{" "}
                  <span>{r.actdescription}</span>
                  {isBilled(r) && <>{" "}<span data-testid="billed-marker" className="rounded bg-slate-100 px-1 text-xs text-slate-600">billed</span></>}
                  {" "}<BillLink billId={r.actbillid} />
                </li>
              ))}
            </ul>
          )}
          <p className="text-sm font-medium" data-testid="unbilled-hours">Unbilled hours: {unbilledHours(rows)}</p>
        </>
      )}
      <div className="flex gap-3 text-sm">
        <Link href={href} className="underline">Add entry</Link>
        <Link href={href} className="underline">Start timer</Link>
      </div>
    </section>
  );
}
