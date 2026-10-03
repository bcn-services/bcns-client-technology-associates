/**
 * The `/reports` preset table: one row per familiar legacy report name, each naming an engine and the
 * parameters that engine takes for the chosen date range. Adding a seventh report is adding one row to
 * `PRESETS` — never a new engine, never a new route, never another copy of a query.
 *
 * Read-only throughout. `requireSession()` stays at the page entry point (house pattern,
 * `app/expenses/page.tsx:18`); nothing in this module reads a session or issues a write.
 */
import type { Db } from "@/lib/time/entries";
import { expenseDetail, incomeDetail, type DetailFilter, type ExpenseDetail, type IncomeDetail } from "@/lib/reports/detail";
import { monthMatrix, type Dimension, type MonthMatrix } from "@/lib/reports/matrix";
import { pnlRange, type Pnl } from "@/lib/reports/pnl";

/** Inclusive `yyyy-mm-dd` range, exactly as the two date inputs submit it. */
export type Range = { start: string; end: string };

export const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;

/** Shape plus calendar validity — `2026-02-31` parses as a string but is not a day. */
export function isDate(v: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const d = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
}

/** A valid range is two real days in order; the engines treat both ends as inclusive. */
export const isRange = (r: Range): boolean => isDate(r.start) && isDate(r.end) && r.start <= r.end;

/** The standalone yearly rollups are per-calendar-year reports: the year is the one the range opens in. */
export const yearOf = (r: Range): number => Number(r.start.slice(0, 4));

/** The engine a row runs, paired with the parameters that engine's signature takes. */
type Spec =
  | { engine: "expenseDetail"; params: (r: Range) => DetailFilter }
  | { engine: "incomeDetail"; params: (r: Range) => DetailFilter }
  | { engine: "matrix"; params: (r: Range) => { year: number; dimension: Dimension } }
  | { engine: "pnl"; params: (r: Range) => { start: string; end: string } };

export type Preset = Spec & {
  /** Submitted as `?preset=`. */
  key: string;
  /** The button's accessible name, and the panel caption. Journey 06 matches on these. */
  label: string;
  /** The period the row actually covers — a yearly rollup ignores the day-level range. */
  period: (r: Range) => string;
  /** Shown under the caption when the row needs a word of explanation. */
  note?: string;
};

export type PresetResult =
  | { engine: "expenseDetail"; data: ExpenseDetail }
  | { engine: "incomeDetail"; data: IncomeDetail }
  | { engine: "matrix"; data: MonthMatrix }
  | { engine: "pnl"; data: Pnl };

const span = (r: Range) => `${r.start} to ${r.end}`;
const year = (r: Range) => String(yearOf(r));
/** A range that is exactly one calendar year reads as that year ("2025"); anything else prints its dates. */
const spanOrYear = (r: Range) => (r.start === `${year(r)}-01-01` && r.end === `${year(r)}-12-31` ? year(r) : span(r));

export const PRESETS: Preset[] = [
  { key: "monthly-expense", label: "Monthly Expense Report", engine: "expenseDetail", params: (r) => ({ start: r.start, end: r.end }), period: span },
  { key: "monthly-income", label: "Monthly Income Report", engine: "incomeDetail", params: (r) => ({ start: r.start, end: r.end }), period: span },
  { key: "yearly-expense", label: "Yearly Expense Report", engine: "matrix", params: (r) => ({ year: yearOf(r), dimension: "exptype" }), period: year },
  { key: "yearly-income", label: "Yearly Income Report", engine: "matrix", params: (r) => ({ year: yearOf(r), dimension: "branch" }), period: year },
  { key: "pnl", label: "P&L", engine: "pnl", params: (r) => ({ start: r.start, end: r.end }), period: spanOrYear },
  {
    key: "consultant-fees",
    label: "Consultant Fees",
    engine: "expenseDetail",
    params: (r) => ({ start: r.start, end: r.end, description: "consultant" }),
    period: span,
    note: "Expenses whose description mentions a consultant — the legacy All_Consultants cut.",
  },
  {
    key: "accountant-export",
    label: "Accountant Export",
    engine: "pnl",
    params: (r) => ({ start: r.start, end: r.end }),
    period: spanOrYear,
    note: "The P&L below previews the chosen range. Export to Excel downloads the hand-over for that range: a monthly income and a monthly expense sheet for each month it touches, then the Yearly Income and Yearly Expense rollups and the P&L. A full calendar year gives the usual 27 sheets.",
  },
];

export const findPreset = (key: string): Preset | undefined => PRESETS.find((p) => p.key === key);

/**
 * Runs one row against its engine. The only place a preset's parameters reach a query.
 * `clip` (matrix rows only) narrows the preset's calendar year to a date range; the accountant export uses it.
 */
export async function runPreset(db: Db, p: Preset, r: Range, clip?: Range): Promise<PresetResult> {
  switch (p.engine) {
    case "expenseDetail":
      return { engine: "expenseDetail", data: await expenseDetail(db, p.params(r)) };
    case "incomeDetail":
      return { engine: "incomeDetail", data: await incomeDetail(db, p.params(r)) };
    case "matrix": {
      const a = p.params(r);
      return { engine: "matrix", data: await monthMatrix(db, a.year, a.dimension, clip) };
    }
    case "pnl": {
      const a = p.params(r);
      return { engine: "pnl", data: await pnlRange(db, a.start, a.end) };
    }
  }
}
