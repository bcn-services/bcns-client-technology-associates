import { fmtCents } from "@/lib/expenses/list";
import { billHours, summarize, type BillLine } from "@/lib/bills/lines";
import { centsText, hoursText } from "@/lib/bills/finalize-model";

/** Bill lines as the bill reads them, plus the hours and balance `summarize` computes (the same function the save uses). */
export function LinesTable({ lines, testid }: { lines: BillLine[]; testid: string }) {
  const sum = summarize(lines);
  return (
    <div className="space-y-1">
      <table data-testid={testid} className="w-full text-sm">
        <thead>
          <tr className="text-left text-slate-500">
            <th className="pr-4">Date</th><th className="pr-4">Description</th><th className="pr-4 text-right">Hours</th><th className="text-right">Amount</th>
          </tr>
        </thead>
        <tbody>
          {lines.map((l, i) => (
            <tr key={i} data-kind={l.kind} className={l.rate !== null ? "font-medium" : undefined}>
              <td className="pr-4">{l.linedate ?? ""}</td>
              <td className="pr-4">{l.kind === "credit" ? `Credit: ${l.description}` : l.description}</td>
              <td className="pr-4 text-right tabular-nums">{l.hours !== null && l.rate === null ? hoursText(l.hours) : ""}</td>
              <td className="text-right tabular-nums">{l.amount !== 0 ? `${l.kind === "credit" ? "−" : ""}$${fmtCents(l.amount)}` : ""}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p data-testid={`${testid}-total`} className="text-sm font-semibold">
        Total hours {centsText(billHours(sum.hours) / 10)} · Balance ${fmtCents(sum.balance)}{sum.estimated ? " (estimate)" : ""}
      </p>
    </div>
  );
}
