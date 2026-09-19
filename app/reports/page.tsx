import "./print.css";
import { requireSession } from "@/lib/auth/session";
import { createServerClient } from "@/lib/db/client";
import type { Db } from "@/lib/time/entries";
import {
  MONTHS,
  PRESETS,
  findPreset,
  isRange,
  runPreset,
  type Preset,
  type PresetResult,
  type Range,
} from "@/lib/reports/presets";

export const dynamic = "force-dynamic";

type Params = Record<string, string | string[] | undefined>;
const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

// House table classes (app/expenses/page.tsx:31-58), one constant per right-aligned money column.
// Written out rather than built from a variable: Tailwind only emits arbitrary variants it can see as literals.
const T7 = "w-full text-sm [&_a]:underline [&_td:nth-child(7)]:text-right [&_td:nth-child(7)]:tabular-nums [&_td]:py-1 [&_td]:pr-3 [&_th]:py-1 [&_th]:pr-3 [&_tr]:border-b";
const T3 = "w-full text-sm [&_a]:underline [&_td:nth-child(3)]:text-right [&_td:nth-child(3)]:tabular-nums [&_td]:py-1 [&_td]:pr-3 [&_th]:py-1 [&_th]:pr-3 [&_tr]:border-b";
const gridTable = "w-full text-sm [&_td:not(:first-child)]:text-right [&_td:not(:first-child)]:tabular-nums [&_td]:py-1 [&_td]:pr-3 [&_th]:py-1 [&_th]:pr-3 [&_tr]:border-b";
const head = "text-left text-slate-700";

/** Detail rows carry nullable columns; a null must render as a blank cell, never as text. */
const txt = (v: string | number | null | undefined) => (v == null ? "" : String(v));

function ExpenseDetailView({ data }: { data: Extract<PresetResult, { engine: "expenseDetail" }>["data"] }) {
  return (
    <div className="space-y-4">
      <div className="overflow-x-auto">
        <table className={T7}>
          <thead>
            <tr className={head}>
              <th>Date</th><th>Type</th><th>Initials</th><th>Description</th><th>Reason</th><th>Check #</th><th className="text-right">Amount</th>
            </tr>
          </thead>
          <tbody>
            {data.rows.map((r) => (
              <tr key={r.expid}>
                <td>{r.expdate}</td>
                <td>{r.typeName}</td>
                <td>{r.initials}</td>
                <td>{txt(r.expdscr)}</td>
                <td>{txt(r.expreason)}</td>
                <td>{txt(r.expchecknum)}</td>
                <td>{r.amount}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="font-semibold">
              <td colSpan={6}>Total ({data.rows.length} {data.rows.length === 1 ? "expense" : "expenses"})</td>
              <td data-testid="report-total">{data.total}</td>
            </tr>
          </tfoot>
        </table>
      </div>
      <h3 className="text-sm font-semibold text-slate-700">By type</h3>
      <div className="overflow-x-auto">
        <table className={T3}>
          <thead>
            <tr className={head}><th>Type</th><th>Entries</th><th className="text-right">Total</th></tr>
          </thead>
          <tbody>
            {data.summary.map((s) => (
              <tr key={s.exptype == null ? "null" : String(s.exptype)}>
                <td>{s.typeName}</td>
                <td>{s.count}</td>
                <td>{s.total}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function IncomeDetailView({ data }: { data: Extract<PresetResult, { engine: "incomeDetail" }>["data"] }) {
  return (
    <div className="overflow-x-auto">
      <table className={T7}>
        <thead>
          <tr className={head}>
            <th>Date</th><th>Attorney</th><th>Description</th><th>Case #</th><th>Payee</th><th>Branch</th><th className="text-right">Amount</th>
          </tr>
        </thead>
        <tbody>
          {data.rows.map((r) => (
            <tr key={r.fndsid}>
              <td>{r.fndsdate}</td>
              <td>{r.attorney}</td>
              <td>{txt(r.fndsdesc)}</td>
              <td>{txt(r.fndscaseid)}</td>
              <td>{txt(r.fndspayee)}</td>
              <td>{txt(r.fndsbranch)}</td>
              <td>{r.amount}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="font-semibold">
            <td colSpan={6}>Total ({data.rows.length} {data.rows.length === 1 ? "receipt" : "receipts"})</td>
            <td data-testid="report-total">{data.total}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

function MatrixView({ data }: { data: Extract<PresetResult, { engine: "matrix" }>["data"] }) {
  // An untouched month is `cents: null` / `amount: ""` — a blank cell, and the string "Null" never appears.
  return (
    <div className="overflow-x-auto">
      <table className={gridTable}>
        <thead>
          <tr className={head}>
            <th>{data.dimension === "exptype" ? "Expense type" : "Branch"}</th>
            {MONTHS.map((m) => <th key={m} className="text-right">{m}</th>)}
            <th className="text-right">Total</th>
          </tr>
        </thead>
        <tbody>
          {data.rows.map((r) => (
            <tr key={r.key}>
              <td>{r.label}</td>
              {r.cells.map((c, i) => <td key={MONTHS[i]}>{c.amount}</td>)}
              <td>{r.total}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="font-semibold">
            <td>{data.totals.label}</td>
            {data.totals.cells.map((c, i) => <td key={MONTHS[i]}>{c.amount}</td>)}
            <td data-testid="report-total">{data.totals.total}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

function PnlView({ data }: { data: Extract<PresetResult, { engine: "pnl" }>["data"] }) {
  const lines = [
    { label: "Income", cell: (m: (typeof data.months)[number]) => m.income, total: data.total.income },
    { label: "Expenses", cell: (m: (typeof data.months)[number]) => m.expenses, total: data.total.expenses },
    { label: "Net", cell: (m: (typeof data.months)[number]) => m.net, total: data.total.net },
    { label: "Withdrawals", cell: (m: (typeof data.months)[number]) => m.withdrawals, total: data.total.withdrawals },
  ];
  return (
    <div className="overflow-x-auto">
      <table className={gridTable}>
        <thead>
          <tr className={head}>
            <th />
            {data.months.map((m) => <th key={m.month} className="text-right">{MONTHS[m.month - 1]}</th>)}
            <th className="text-right">{data.total.label}</th>
          </tr>
        </thead>
        <tbody>
          {lines.map((l) => (
            <tr key={l.label} className={l.label === "Net" ? "font-semibold" : undefined}>
              <td>{l.label}</td>
              {data.months.map((m) => <td key={m.month}>{l.cell(m)}</td>)}
              <td data-testid={l.label === "Net" ? "report-total" : undefined}>{l.total}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Results({ result }: { result: PresetResult }) {
  switch (result.engine) {
    case "expenseDetail":
      return <ExpenseDetailView data={result.data} />;
    case "incomeDetail":
      return <IncomeDetailView data={result.data} />;
    case "matrix":
      return <MatrixView data={result.data} />;
    case "pnl":
      return <PnlView data={result.data} />;
  }
}

/**
 * Read-only reports. A native GET form: each preset button submits `?start=&end=&preset=`, the server
 * runs that row's engine and renders into the one `report-results` panel. No query logic lives here.
 */
export default async function ReportsPage({ searchParams }: { searchParams: Params }) {
  const range: Range = { start: first(searchParams.start), end: first(searchParams.end) };
  const preset = findPreset(first(searchParams.preset));
  const ready = preset != null && isRange(range);
  // Session check and the read run together (saves the auth round trip); nothing renders unless requireSession resolves.
  const [, result] = await Promise.all([
    requireSession(),
    ready ? runPreset(createServerClient() as unknown as Db, preset, range) : Promise.resolve(null),
  ]);
  const problem = preset == null ? "Pick a date range, then choose a report." : "Enter a real start and end date, with the start on or before the end.";

  return (
    <main className="mx-auto max-w-6xl space-y-4 px-4 py-6">
      <h1 className="text-xl font-semibold" data-print="hide">Reports</h1>
      <form method="get" className="space-y-3" data-print="hide">
        <div className="flex flex-wrap items-end gap-3 text-sm">
          <label className="flex flex-col">Start date<input name="start" type="date" defaultValue={range.start} className="rounded border px-2 py-1" /></label>
          <label className="flex flex-col">End date<input name="end" type="date" defaultValue={range.end} className="rounded border px-2 py-1" /></label>
        </div>
        <div className="flex flex-wrap gap-2">
          {PRESETS.map((p: Preset) => (
            <button
              key={p.key}
              type="submit"
              name="preset"
              value={p.key}
              className={`rounded border px-3 py-1 text-sm ${p.key === preset?.key ? "border-slate-800 bg-slate-800 text-white" : "border-slate-300 hover:bg-slate-100"}`}
            >
              {p.label}
            </button>
          ))}
        </div>
      </form>

      <section data-testid="report-results" className="space-y-3 rounded border border-slate-200 bg-white p-4">
        <h2 className="text-lg font-semibold">
          {preset ? preset.label : "Results"}
          {ready && preset ? ` — ${preset.period(range)}` : ""}
        </h2>
        {preset?.note && <p className="text-sm text-slate-600">{preset.note}</p>}
        {result ? <Results result={result} /> : <p className="text-sm text-slate-600">{problem}</p>}
      </section>
    </main>
  );
}
