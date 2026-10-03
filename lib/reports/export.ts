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
export type SheetPlan = { name: string; preset: Preset; range: Range; /** Yearly rollups only: clip the year to this range. */ clip?: Range };

const need = (key: string): Preset => {
  const p = findPreset(key);
  if (!p) throw new Error(`export: unknown preset "${key}"`);
  return p;
};

const compact = (d: string) => d.slice(2).replace(/-/g, "");

/**
 * The hand-over for a date range: a monthly income and a monthly expense sheet for every month the range
 * touches (first and last clipped to the range), then a Yearly Income and Yearly Expense rollup for every
 * calendar year it touches (clipped to the range), then one P&L over the range. A full calendar year is the
 * classic January set: 12 + 12 + 3 = 27 sheets, unclipped.
 */
export function accountantPlan(range: Range): SheetPlan[] {
  const sy = Number(range.start.slice(0, 4));
  const ey = Number(range.end.slice(0, 4));
  const first = sy * 12 + Number(range.start.slice(5, 7)) - 1;
  const last = ey * 12 + Number(range.end.slice(5, 7)) - 1;
  const months: { year: number; month: number }[] = [];
  for (let k = first; k <= last; k++) months.push({ year: Math.floor(k / 12), month: (k % 12) + 1 });
  // yyyy-mm-dd compares lexically, so min/max are plain string comparisons.
  const clipTo = (r: Range): Range => ({ start: r.start > range.start ? r.start : range.start, end: r.end < range.end ? r.end : range.end });

  const monthly = (key: string): SheetPlan[] =>
    months.map(({ year, month }) => {
      const preset = need(key);
      const full = monthRange(year, month);
      const r = clipTo(full);
      // A partly covered month is named by its dates ("Monthly Income 250315-250331"), like a clipped year.
      const name = r.start === full.start && r.end === full.end
        ? sheetName(preset.label, `${MONTHS[month - 1]} ${year}`)
        : sheetName(preset.label.replace(/ Report$/, ""), `${compact(r.start)}-${compact(r.end)}`);
      return { name, preset, range: r };
    });
  const yearly = (key: string): SheetPlan[] => {
    const preset = need(key);
    const out: SheetPlan[] = [];
    for (let year = sy; year <= ey; year++) {
      const full: Range = { start: `${year}-01-01`, end: `${year}-12-31` };
      const r = clipTo(full);
      if (r.start === full.start && r.end === full.end) out.push({ name: sheetName(preset.label, preset.period(r)), preset, range: r });
      // Clipped year: the sheet name says so (31-char limit, hence "Yearly Income 250315-250630").
      else out.push({ name: sheetName(preset.label.replace(/ Report$/, ""), `${compact(r.start)}-${compact(r.end)}`), preset, range: r, clip: r });
    }
    return out;
  };
  const pnlPreset = need("pnl");
  const pnlPlan: SheetPlan = { name: sheetName(pnlPreset.label, pnlPreset.period(range)), preset: pnlPreset, range };
  return [...monthly("monthly-income"), ...monthly("monthly-expense"), ...yearly("yearly-income"), ...yearly("yearly-expense"), pnlPlan];
}

/** The plan for a chosen preset: the accountant row fans out to a sheet per month plus rollups, every other row is one sheet. */
export function planFor(preset: Preset, range: Range): SheetPlan[] {
  if (preset.key === "accountant-export") return accountantPlan(range);
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
      header(ws, ["", ...months.map((m) => m.label), total.label], [16, ...months.map(() => 13), 15]);
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
    case "checkbook": {
      header(ws, ["", "Amount"], [20, 15]);
      for (const l of result.data.lines) ws.addRow([l.label, money(l.cents)]);
      currencyColumns(ws, [2]);
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
    writeSheet(wb.addWorksheet(plan.name), await runPreset(db, plan.preset, plan.range, plan.clip));
  }
  return wb;
}

/** `monthly-expense-2025-03-01-to-2025-03-31.xlsx` — safe on every filesystem, and self-describing in a mail. */
export const workbookFilename = (preset: Preset, range: Range): string =>
  `${preset.key}-${preset.period(range)}.xlsx`.replace(/[^A-Za-z0-9.-]+/g, "-");
