/**
 * P&L summary engine (/reports): read-only. Income, Expenses and Net per month over the chosen date range
 * (`pnlRange`, which may start mid-month and cross a year boundary) or over one calendar year (`pnl`), a
 * total column, and a separate Withdrawals row sourced from `tblexpenses.exp_notcountedinprofit`.
 *
 * `exp_notcountedinprofit` is `numeric(12,2)` NULL-able (supabase/migrations/0001_legacy_schema.sql:211) — a
 * dollar AMOUNT, never a flag. It is null-coalesced to 0 and summed in cents; it is never read for truthiness,
 * so a row carrying 0.00 and a row carrying NULL are both simply "no withdrawal" by arithmetic, not by a branch.
 *
 * `exp_notcountedinprofit` is EXCLUDED from the Expenses line and reported only on the Withdrawals row:
 *     expensesCents     = sum(expamount)                       // this column is never summed in
 *     netCents          = incomeCents - expensesCents          // so withdrawals never enter Net either
 *     withdrawalsCents  = sum(coalesce(exp_notcountedinprofit, 0))
 * The Withdrawals row is a memo line: Income, Expenses and Net are all independent of it, so changing a
 * withdrawal amount moves the Withdrawals row and nothing else. Consequently the Expenses year total equals
 * the `exptype` year total of `lib/reports/matrix.ts` over the same year, to the cent.
 *
 * An as-of month TRUNCATES: `months` has exactly `asOfMonth` entries and the year total covers only those
 * elapsed months. There is no entry at all for a later month — the remaining months are absent, not zero-filled.
 * That is how the client's quarterly CT PTE snapshots (`P&L_03-31-25`, `05-31`, `08-31`) are produced.
 *
 * Session: `requireSession()` stays at the page entry point; no lib query module in this codebase calls it.
 * Paging (`pageAll`) and the integer-cent helpers are reused — money never touches a float here.
 */
import type { Db } from "@/lib/time/entries";
import { fmtCents, toCents } from "@/lib/expenses/list";
import { pageAll } from "@/lib/reports/detail";

export type PnlMonth = {
  /** 1..12. */
  month: number;
  /** Calendar year of this column. */
  year: number;
  /** Column heading: "Jan", or "Jan 2026" when the report spans more than one calendar year. */
  label: string;
  incomeCents: number;
  income: string;
  expensesCents: number;
  expenses: string;
  netCents: number;
  net: string;
  /** Memo only: sum of `exp_notcountedinprofit`. Not in `expensesCents`, not in `netCents`. */
  withdrawalsCents: number;
  withdrawals: string;
};

export type PnlTotal = Omit<PnlMonth, "month" | "year"> & { label: string };

export type Pnl = {
  /** Year the range opens in. */
  year: number;
  /** Inclusive range actually queried. */
  start: string;
  end: string;
  /** `months.length`. */
  asOfMonth: number;
  /** One entry per calendar month the range touches, first to last. No entry exists for any later month. */
  months: PnlMonth[];
  total: PnlTotal;
};

/** Last day of `year`-`month` (1-based), leap years included. Day 0 of the next month is the last of this one. */
const lastDay = (year: number, month: number): string => new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);

/** A caller's as-of month is clamped into 1..12, so a stray 0 or 13 can never grow or empty the result. */
const clampMonth = (m: number): number => Math.min(12, Math.max(1, Math.trunc(m)));

const SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const shortMonth = (_year: number, month: number): string => SHORT[month - 1] ?? "";

/** Calendar year, 1..12 as-of snapshot. Delegates to `pnlRange`, so the two can never disagree. */
export const pnl = (db: Db, year: number, asOfMonth: number = 12): Promise<Pnl> =>
  pnlRange(db, `${year}-01-01`, lastDay(year, clampMonth(asOfMonth)));

/** @param start inclusive `yyyy-mm-dd` @param end inclusive `yyyy-mm-dd`, on or after `start`. */
export async function pnlRange(db: Db, start: string, end: string): Promise<Pnl> {
  const sy = Number(start.slice(0, 4));
  const sm = Number(start.slice(5, 7));
  const ey = Number(end.slice(0, 4));
  const em = Number(end.slice(5, 7));
  const asOf = (ey - sy) * 12 + (em - sm) + 1;

  const [expenses, funds] = await Promise.all([
    pageAll(
      (count) =>
        db
          .from("tblexpenses")
          .select("expid, expdate, expamount, exp_notcountedinprofit", count ? { count: "exact" } : undefined)
          .gte("expdate", start)
          .lte("expdate", end)
          .order("expid"),
      "tblexpenses pnl",
    ),
    pageAll(
      (count) =>
        db
          .from("tblfundsrcvd")
          .select("fndsid, fndsdate, fndspmt", count ? { count: "exact" } : undefined)
          .gte("fndsdate", start)
          .lte("fndsdate", end)
          .order("fndsid"),
      "tblfundsrcvd pnl",
    ),
  ]);

  // Month index comes from the date string itself, so no timezone can move a row across a month boundary.
  const monthOf = (d: unknown): number => (Number(String(d).slice(0, 4)) - sy) * 12 + Number(String(d).slice(5, 7)) - sm;
  const income = Array<number>(asOf).fill(0);
  const spend = Array<number>(asOf).fill(0);
  const draws = Array<number>(asOf).fill(0);

  // No in-loop month guard: the query's `start`..`end` bounds already are the range, and duplicating them
  // here would be an unreachable branch that no fixture can exercise.
  for (const r of funds) { const i = monthOf(r.fndsdate); income[i] = (income[i] ?? 0) + toCents(r.fndspmt); }
  for (const r of expenses) {
    const i = monthOf(r.expdate);
    spend[i] = (spend[i] ?? 0) + toCents(r.expamount);
    // `?? 0`, never `if (r.exp_notcountedinprofit)`: 0.00 and NULL are distinct values that happen to add 0.
    draws[i] = (draws[i] ?? 0) + toCents(r.exp_notcountedinprofit ?? 0);
  }

  const months: PnlMonth[] = [];
  const sum = { incomeCents: 0, expensesCents: 0, netCents: 0, withdrawalsCents: 0 };
  for (let i = 0; i < asOf; i += 1) {
    const incomeCents = income[i] ?? 0;
    const expensesCents = spend[i] ?? 0;
    const netCents = incomeCents - expensesCents;
    const withdrawalsCents = draws[i] ?? 0;
    sum.incomeCents += incomeCents;
    sum.expensesCents += expensesCents;
    sum.netCents += netCents;
    sum.withdrawalsCents += withdrawalsCents;
    const idx = sm - 1 + i;
    const year = sy + Math.floor(idx / 12);
    const month = (idx % 12) + 1;
    months.push({
      month,
      year,
      label: ey === sy ? shortMonth(year, month) : `${shortMonth(year, month)} ${year}`,
      incomeCents,
      income: fmtCents(incomeCents),
      expensesCents,
      expenses: fmtCents(expensesCents),
      netCents,
      net: fmtCents(netCents),
      withdrawalsCents,
      withdrawals: fmtCents(withdrawalsCents),
    });
  }

  return {
    year: sy,
    start,
    end,
    asOfMonth: asOf,
    months,
    total: {
      label: start === `${sy}-01-01` && end === `${sy}-12-31` ? "Total For Year" : "Total For Period",
      incomeCents: sum.incomeCents,
      income: fmtCents(sum.incomeCents),
      expensesCents: sum.expensesCents,
      expenses: fmtCents(sum.expensesCents),
      netCents: sum.netCents,
      net: fmtCents(sum.netCents),
      withdrawalsCents: sum.withdrawalsCents,
      withdrawals: fmtCents(sum.withdrawalsCents),
    },
  };
}
