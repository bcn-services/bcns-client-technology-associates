/**
 * Month-matrix report engine (/reports): read-only. One row per dimension value with activity in the year,
 * twelve month columns, a year total per row, and a totals row.
 *
 *  - dimension `exptype` reproduces the legacy Yearly Expense Report (tblexpenses.expamount by tblexptype)
 *  - dimension `branch`  reproduces the legacy Yearly Income Report  (tblfundsrcvd.fndspmt by fndsbranch)
 *
 * Two legacy defects are deliberately NOT carried over:
 *  1. the legacy form prints the string `Null` in an untouched month — here an untouched month is `cents: null`
 *     and `amount: ""`, and the string "Null" is never produced anywhere in the returned structure;
 *  2. the legacy form drops retired expense types — `tblexptype.active` is nullable and gates the picker only,
 *     so no `active` filter is applied and every dimension value present in the data gets its row.
 *
 * Session: `requireSession()` stays at the page entry point; no lib query module in this codebase calls it.
 * Paging and the integer-cent helpers are reused from the detail engine — money never touches a float here.
 */
import type { Db } from "@/lib/time/entries";
import { fmtCents, toCents } from "@/lib/expenses/list";
import { pageAll } from "@/lib/reports/detail";

export type Dimension = "exptype" | "branch";

/** An untouched month: `cents` is null and `amount` is the empty string. Never the string "Null". */
export type MatrixCell = { cents: number | null; amount: string };

export type MatrixRow = {
  /** `String(exptypeid)` (or `"null"` for an untyped expense) / the branch name. */
  key: string;
  label: string;
  /** Exactly 12 cells, January..December. */
  cells: MatrixCell[];
  totalCents: number;
  total: string;
};

export type MonthMatrix = {
  year: number;
  dimension: Dimension;
  /** One row per dimension value with at least one row in the year — nothing else, no zero-filled rows. */
  rows: MatrixRow[];
  /** Same shape as a row, folded down the columns; `label` is "Total". */
  totals: MatrixRow;
};

const cell = (cents: number | null): MatrixCell => ({ cents, amount: cents == null ? "" : fmtCents(cents) });

const toRow = (key: string, label: string, monthCents: (number | null)[]): MatrixRow => {
  let totalCents = 0;
  for (const c of monthCents) totalCents += c ?? 0;
  return { key, label, cells: monthCents.map(cell), totalCents, total: fmtCents(totalCents) };
};

/**
 * `year` is read as the inclusive `yyyy-01-01`..`yyyy-12-31` range and the month column comes from the date
 * string itself, so December and the following January can never be conflated by a boundary or a timezone.
 */
export async function monthMatrix(db: Db, year: number, dimension: Dimension, clip?: { start: string; end: string }): Promise<MonthMatrix> {
  // `clip` narrows the year to a chosen date range (the accountant export); yyyy-mm-dd compares lexically.
  const yStart = `${year}-01-01`;
  const yEnd = `${year}-12-31`;
  const start = clip && clip.start > yStart ? clip.start : yStart;
  const end = clip && clip.end < yEnd ? clip.end : yEnd;

  const buckets = new Map<string, { label: string; months: (number | null)[] }>();
  const add = (key: string, label: string, month: number, cents: number) => {
    const b = buckets.get(key) ?? { label, months: Array(12).fill(null) };
    b.months[month] = (b.months[month] ?? 0) + cents;
    buckets.set(key, b);
  };

  if (dimension === "exptype") {
    // No `active` filter on tblexptype: `active` is nullable and gates the picker, never the report.
    const [raw, types] = await Promise.all([
      pageAll(
        (count) =>
          db
            .from("tblexpenses")
            .select("expid, expdate, exptype, expamount", count ? { count: "exact" } : undefined)
            .gte("expdate", start)
            .lte("expdate", end)
            .order("expid"),
        "tblexpenses matrix",
      ),
      pageAll(
        (count) => db.from("tblexptype").select("exptypeid, exptype", count ? { count: "exact" } : undefined).order("exptypeid"),
        "tblexptype read",
      ),
    ]);
    const typeName = new Map<number, string>(types.map((t: any) => [t.exptypeid, t.exptype]));
    for (const r of raw) {
      const key = String(r.exptype ?? "null");
      const label = r.exptype == null ? "" : typeName.get(r.exptype) ?? `#${r.exptype}`;
      add(key, label, Number(String(r.expdate).slice(5, 7)) - 1, toCents(r.expamount));
    }
  } else {
    const raw = await pageAll(
      (count) =>
        db
          .from("tblfundsrcvd")
          .select("fndsid, fndsdate, fndsbranch, fndspmt", count ? { count: "exact" } : undefined)
          .gte("fndsdate", start)
          .lte("fndsdate", end)
          .order("fndsid"),
      "tblfundsrcvd matrix",
    );
    // Branches are folded from the rows in range only — a branch quiet all year has no row, not a zero row.
    for (const r of raw) {
      const key = String(r.fndsbranch ?? "");
      add(key, key, Number(String(r.fndsdate).slice(5, 7)) - 1, toCents(r.fndspmt));
    }
  }

  const rows = [...buckets.entries()]
    .map(([key, b]) => toRow(key, b.label, b.months))
    .sort((a, b) => (a.label < b.label ? -1 : a.label > b.label ? 1 : 0) || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));

  const columns: (number | null)[] = Array(12).fill(null);
  for (const r of rows) {
    r.cells.forEach((c, i) => {
      if (c.cents != null) columns[i] = (columns[i] ?? 0) + c.cents;
    });
  }

  return { year, dimension, rows, totals: toRow("total", "Total", columns) };
}
