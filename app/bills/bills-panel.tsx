import Link from "next/link";
import { requireSession, type Session } from "@/lib/auth/session";
import { createServerClient } from "@/lib/db/client";
import type { Db } from "@/lib/time/entries";
import { listCaseBills, type CaseBillRow } from "@/lib/bills/case";
import { fmtMoney } from "@/lib/bills/edit";
import { isOpen } from "@/lib/bills/rules";
import { loadBillOutput, type BillOutput } from "@/lib/bills/output";
import { listBillChecks, type BillCheck } from "@/lib/funds/case";

// Case-page selector traps: exactly one heading matching /bills/i (journey 01); no text matching /billed/i
// (journey 03 reads that from the time panel); no buttons, no labelled inputs (tests/cases). Reads only.
// Bill output (item 8): typed bills get a line with their state and output links below the table; legacy bills get none.

/** Loads the case's bills; a failed read renders a note instead of breaking the case page. */
export async function BillsPanel({ caseId, db, session }: { caseId: number; db?: Db; session?: Pick<Session, "role"> }) {
  const s = session ?? (await requireSession());
  const d = db ?? (createServerClient() as unknown as Db);
  const bills = await listCaseBills(d, caseId).catch((e) => { console.error("case bills read:", e); return null; });
  const admin = s.role === "admin";
  const [checks, output] = bills ? await Promise.all([
    listBillChecks(d, bills.map((b) => b.billid)).catch((e) => { console.error("bill checks read:", e); return null; }),
    loadBillOutput(d, bills, admin).catch((e) => { console.error("bill output read:", e); return null; }),
  ]) : [[], new Map()];
  return <BillsPanelView caseId={caseId} bills={bills} admin={admin} checks={checks} output={output} />;
}

/** `bills` must be newest first (listCaseBills order): the first open one is the latest open bill. */
export function BillsPanelView({ caseId, bills, admin, checks = [], output = new Map() }: {
  caseId: number; bills: CaseBillRow[] | null; admin: boolean; checks?: BillCheck[] | null; output?: Map<number, BillOutput> | null;
}) {
  const open = bills?.filter((b) => isOpen(b.billnotice)) ?? [];
  const latest = open[0];
  return (
    <section id="bills-panel" data-testid="bills-panel" className="space-y-2 rounded border border-slate-200 p-3">
      <h2 className="font-semibold">Bills</h2>
      {bills == null ? (
        <p className="text-sm text-red-700">Bills could not be loaded.</p>
      ) : (
        <>
          {bills.length === 0 ? (
            <p className="text-sm text-slate-500">No bills on this case</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-slate-500">
                  <th className="py-1 font-normal">Date</th><th className="font-normal">Type</th>
                  <th className="text-right font-normal">Balance</th><th className="pl-3 font-normal">Status</th>
                </tr>
              </thead>
              <tbody>
                {bills.map((b) => (
                  <tr key={b.billid} data-testid="case-bill" className="border-t border-slate-100">
                    <td className="py-1"><Link href={`/bills/${b.billid}`} className="underline">{b.billdate}</Link></td>
                    <td>{b.billtype ?? ""}</td>
                    <td className="text-right tabular-nums">{fmtMoney(b.billbalance)}</td>
                    <td className="pl-3">{b.billnotice}{b.billnotice === "Paid" && b.billpaiddate ? <span data-testid="bill-paid-date"> {b.billpaiddate}</span> : null}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {/* Bill output: one line per typed bill, outside the case-bill rows (each row keeps one link). Staff: state + Download. */}
          {output == null ? (
            <p className="text-sm text-red-700">Bill output could not be loaded.</p>
          ) : output.size > 0 && (
            <ul aria-label="Bill output" data-testid="bill-output" className="space-y-1 text-sm">
              {bills.filter((b) => output.has(b.billid)).map((b) => {
                const o = output.get(b.billid)!;
                return (
                  <li key={b.billid} data-testid="bill-output-row" data-billid={b.billid} className="flex flex-wrap gap-x-3">
                    <span>{`${b.billdate} ${b.billtype}:`}</span>
                    <span data-testid="bill-state" className="font-medium">{o.state}</span>
                    {o.download && <a href={`/bills/${b.billid}/pdf`} data-testid="bill-download" className="underline">Download PDF</a>}
                    {o.finalize && <Link href={`/bills/${b.billid}/finalize`} data-testid="bill-finalize" className="underline">Finalize</Link>}
                    {o.send && <Link href={`/bills/${b.billid}/send${o.sent ? "?again=1" : ""}`} data-testid="bill-send" className="underline">{o.sent ? "Send again" : "Send"}</Link>}
                    {o.sendNotice && <Link href={`/bills/${b.billid}/notice`} data-testid="bill-send-notice" className="underline">{`Send ${b.billnotice} notice`}</Link>}
                  </li>
                );
              })}
            </ul>
          )}
          {/* Checks applied to each bill (reversal rows included), outside the case-bill rows so each row keeps one link. */}
          {checks == null ? (
            <p className="text-sm text-red-700">Applied checks could not be loaded.</p>
          ) : checks.length > 0 && (
            <ul aria-label="Applied checks" data-testid="bill-checks" className="text-sm">
              {bills.flatMap((b) => checks.filter((c) => c.fndsbillid === b.billid).map((c) => (
                <li key={c.fndsid} data-testid="bill-check" data-billid={b.billid}>
                  Bill {b.billid} ({b.billdate}): <Link href={`/funds/${c.fndsid}`} className="underline">{c.fndsdate} · ${c.amount}</Link>
                </li>
              )))}
            </ul>
          )}
          {/* Outside the case-bill rows: each row keeps exactly one link, to its own bill page. */}
          {open.length > 0 && (
            <ul className="text-sm">
              {open.map((b) => (
                <li key={b.billid}><Link href={`/funds/new?case=${caseId}&bill=${b.billid}`} className="underline">Record payment ({b.billdate})</Link></li>
              ))}
            </ul>
          )}
          <dl className="grid grid-cols-[auto_1fr] gap-x-2 text-sm">
            <dt className="text-slate-500">Unpaid</dt><dd data-testid="unpaid-bill-count" className="font-medium">{open.length}</dd>
            <dt className="text-slate-500">2nd notice</dt><dd data-testid="second-notice-date">{latest?.billsecondnoticedate ?? ""}</dd>
            <dt className="text-slate-500">Final notice</dt><dd data-testid="final-notice-date">{latest?.billfinalnoticedate ?? ""}</dd>
          </dl>
        </>
      )}
      {admin && <Link href={`/bills/new?case=${caseId}`} className="text-sm underline">New bill</Link>}
    </section>
  );
}
