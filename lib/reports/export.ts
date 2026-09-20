/**
 * Excel export for `/reports`. Every figure in a workbook comes from `runPreset` — the same call, with the
 * same arguments, that the page makes to render the panel on screen. No query, no engine and no arithmetic
 * lives here; this module only lays engine output onto worksheets.
 *
 * Currency cells carry the integer-cent value divided by 100 as a NUMBER with a currency `numFmt`. The
 * formatted strings the engines carry beside the cents (`amount`, `total`, ...) are display-only and are
 * never written into a cell — an accountant needs to sum the column.
 *
 * Headers are readable labels. The legacy Access field names (`FndsBranch`, `ExpDscr`) stop at the query.
 */
import { Workbook, type Worksheet } from "exceljs";
import type { Db } from "@/lib/time/entries";
import {
  MONTHS,
  findPreset,
  runPreset,
  yearOf,
  type Preset,
  type PresetResult,
  type Range,
} from "@/lib/reports/presets";

export const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

/** Accounting-style dollars: thousands separated, two decimals, negatives parenthesised. */
const MONEY = '#,##0.00;(#,##0.00)';

const money = (cents: number): number => cents / 100;

/** Excel rejects `* ? : \ / [ ]` in a sheet name and truncates past 31 characters — do both deliberately. */
export const sheetName = (label: string, period: string): string =>
  `${label} ${period}`.replace(/[*?:\\/[\]]/g, "-").slice(0, 31);

/** Last day of `year`-`month` (1-based): day 0 of the next month. */
const lastDay = (year: number, month: number): string => new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);

const monthRange = (year: number, month: number): Range => ({ start: `${year}-${String(month).padStart(2, "0")}-01`, end: lastDay(year, month) });

/** One row of the workbook plan: which preset to run, over which range, onto which sheet. */
export type SheetPlan = { name: string; preset: Preset; range: Range };

const need = (key: string): Preset => {
  const p = findPreset(key);
  if (!p) throw new Error(`export: unknown preset "${key}"`);
  return p;
};

/**
 * The set the client hands the accountant each January: twelve monthly income sheets, twelve monthly
 * expense sheets, then the Yearly Income, Yearly Expense and P&L rollups. 27 sheets, always.
 */
export function accountantPlan(year: number): SheetPlan[] {
  const monthly = (key: string) =>
    MONTHS.map((m, i) => {
      const preset = need(key);
      const range = monthRange(year, i + 1);
      return { name: sheetName(preset.label, `${m} ${year}`), preset, range };
    });
  const yearly = (key: string): SheetPlan => {
    const preset = need(key);
    const range: Range = { start: `${year}-01-01`, end: `${year}-12-31` };
    return { name: sheetName(preset.label, preset.period(range)), preset, range };
  };
  return [...monthly("monthly-income"), ...monthly("monthly-expense"), yearly("yearly-income"), yearly("yearly-expense"), yearly("pnl")];
}

/** The plan for a chosen preset: the accountant row fans out to 27 sheets, every other row is one sheet. */
export function planFor(preset: Preset, range: Range): SheetPlan[] {
  if (preset.key === "accountant-export") return accountantPlan(yearOf(range));
  return [{ name: sheetName(preset.label, preset.period(range)), preset, range }];
}

/** Header row, bold, with a fixed width per column. */
const header = (ws: Worksheet, labels: string[], widths: number[]): void => {
  ws.addRow(labels).font = { bold: true };
  labels.forEach((_, i) => {
    ws.getColumn(i + 1).width = widths[i] ?? 14;
  });
};

/** Marks the 1-based columns that hold money, so a cell added later still formats. */
const currencyColumns = (ws: Worksheet, cols: number[]): void => {
  for (const c of cols) ws.getColumn(c).numFmt = MONEY;
};

function writeSheet(ws: Worksheet, result: PresetResult): void {
  switch (result.engine) {
    case "expenseDetail": {
      const { rows, summary, totalCents } = result.data;
      header(ws, ["Date", "Expense type", "Initials", "Description", "Reason", "Check #", "Amount"], [12, 22, 9, 34, 28, 10, 14]);
      for (const r of rows) ws.addRow([r.expdate, r.typeName, r.initials, r.expdscr ?? "", r.expreason ?? "", r.expchecknum ?? "", money(r.amountCents)]);
      ws.addRow([`Total (${rows.length} ${rows.length === 1 ? "expense" : "expenses"})`, "", "", "", "", "", money(totalCents)]).font = { bold: true };
      ws.addRow([]);
      ws.addRow(["By type"]).font = { bold: true };
      ws.addRow(["Expense type", "Entries", "Total"]).font = { bold: true };
      // Column 3 holds "Initials" up top and the by-type totals down here, so the summary cells are formatted
      // one at a time rather than by column.
      for (const s of summary) ws.addRow([s.typeName, s.count, money(s.totalCents)]).getCell(3).numFmt = MONEY;
      currencyColumns(ws, [7]);
      return;
    }
    case "incomeDetail": {
      const { rows, totalCents } = result.data;
      header(ws, ["Date", "Attorney", "Description", "Case #", "Payee", "Branch", "Amount"], [12, 22, 34, 10, 26, 18, 14]);
      for (const r of rows) ws.addRow([r.fndsdate, r.attorney, r.fndsdesc ?? "", r.fndscaseid ?? "", r.fndspayee ?? "", r.fndsbranch, money(r.amountCents)]);
      ws.addRow([`Total (${rows.length} ${rows.length === 1 ? "receipt" : "receipts"})`, "", "", "", "", "", money(totalCents)]).font = { bold: true };
      currencyColumns(ws, [7]);
      return;
    }
    case "matrix": {
      const { dimension, rows, totals } = result.data;
      header(ws, [dimension === "exptype" ? "Expense type" : "Branch", ...MONTHS, "Total"], [26, ...MONTHS.map(() => 13), 15]);
      // A month the dimension never touched is `cells[i].cents === null` — it stays an empty cell, never a 0.
      const line = (r: typeof totals) => [r.label, ...r.cells.map((c) => (c.cents == null ? null : money(c.cents))), money(r.totalCents)];
      for (const r of rows) ws.addRow(line(r));
      ws.addRow(line(totals)).font = { bold: true };
      currencyColumns(ws, MONTHS.map((_, i) => i + 2).concat(MONTHS.length + 2));
      return;
    }
    case "pnl": {
      const { months, total } = result.data;
      header(ws, ["", ...months.map((m) => MONTHS[m.month - 1] ?? ""), total.label], [16, ...months.map(() => 13), 15]);
      const lines: [string, (m: (typeof months)[number]) => number, number][] = [
        ["Income", (m) => m.incomeCents, total.incomeCents],
        ["Expenses", (m) => m.expensesCents, total.expensesCents],
        ["Net", (m) => m.netCents, total.netCents],
        ["Withdrawals", (m) => m.withdrawalsCents, total.withdrawalsCents],
      ];
      for (const [label, cell, sum] of lines) {
        const row = ws.addRow([label, ...months.map((m) => money(cell(m))), money(sum)]);
        if (label === "Net") row.font = { bold: true };
      }
      currencyColumns(ws, months.map((_, i) => i + 2).concat(months.length + 2));
      return;
    }
  }
}

/**
 * Builds the workbook for one preset. Sheets are filled sequentially: the accountant export runs 27 engine
 * passes and a year of receipts is small, so a parallel fan-out would only put 27 queries on the pool at once.
 * ponytail: sequential fill — parallelise if a year's export ever gets slow enough to notice.
 */
export async function buildWorkbook(db: Db, preset: Preset, range: Range): Promise<Workbook> {
  const wb = new Workbook();
  wb.created = new Date();
  for (const plan of planFor(preset, range)) {
    writeSheet(wb.addWorksheet(plan.name), await runPreset(db, plan.preset, plan.range));
  }
  return wb;
}

/** `monthly-expense-2025-03-01-to-2025-03-31.xlsx` — safe on every filesystem, and self-describing in a mail. */
export const workbookFilename = (preset: Preset, range: Range): string =>
  `${preset.key}-${preset.period(range)}.xlsx`.replace(/[^A-Za-z0-9.-]+/g, "-");
