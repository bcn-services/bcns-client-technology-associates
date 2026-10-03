/**
 * Checkbook comparison (legacy `ClearedExpensesAndIncome`, `Update_Click`): read-only totals over an inclusive
 * date range, exactly as the Access form computes them:
 *
 *     Expenses        = Σ ExpAmount               where ExpDate  in [start, end]
 *     Non-profit      = Σ Exp_NotCountedInProfit  where ExpDate  in [start, end]   (an AMOUNT column, Nz → 0)
 *     Income          = Σ FndsPmt                 where FndsDate in [start, end]
 *     Net             = Income − Expenses
 *     CheckBook       = Income − Expenses − Non-profit
 *     TotalWithdrawls = Expenses + Non-profit
 *
 * The filters are the entry dates, NOT the cleared dates, and there is no cleared flag or bank-account filter:
 * the legacy form's cleared/Bank_Of_America DSums are commented out. Rows are therefore counted whether or not
 * they cleared. Money is summed in integer cents.
 */
import type { Db } from "@/lib/time/entries";
import { fmtCents, toCents } from "@/lib/expenses/list";
import { pageAll } from "@/lib/reports/detail";

export type CheckbookLine = { label: string; cents: number; amount: string };
export type Checkbook = { start: string; end: string; lines: CheckbookLine[] };

type ExpRow = { expamount: number | string; exp_notcountedinprofit: number | string | null };
type FndsRow = { fndspmt: number | string };

/** The arithmetic alone, so the formula is testable without a database. */
export function checkbookLines(expenses: ExpRow[], funds: FndsRow[]): CheckbookLine[] {
  let exp = 0;
  let nonProfit = 0;
  let income = 0;
  for (const r of expenses) {
    exp += toCents(r.expamount);
    nonProfit += toCents(r.exp_notcountedinprofit ?? 0);
  }
  for (const r of funds) income += toCents(r.fndspmt);
  const line = (label: string, cents: number): CheckbookLine => ({ label, cents, amount: fmtCents(cents) });
  return [
    line("Expenses", exp),
    line("Non-profit", nonProfit),
    line("Income", income),
    line("Net", income - exp),
    line("CheckBook", income - exp - nonProfit),
    line("Total withdrawals", exp + nonProfit),
  ];
}

export async function checkbook(db: Db, start: string, end: string): Promise<Checkbook> {
  const [expenses, funds] = await Promise.all([
    pageAll(
      (count) =>
        db.from("tblexpenses")
          .select("expid, expamount, exp_notcountedinprofit", count ? { count: "exact" } : undefined)
          .gte("expdate", start).lte("expdate", end).order("expid"),
      "tblexpenses checkbook",
    ),
    pageAll(
      (count) =>
        db.from("tblfundsrcvd")
          .select("fndsid, fndspmt", count ? { count: "exact" } : undefined)
          .gte("fndsdate", start).lte("fndsdate", end).order("fndsid"),
      "tblfundsrcvd checkbook",
    ),
  ]);
  return { start, end, lines: checkbookLines(expenses, funds) };
}
