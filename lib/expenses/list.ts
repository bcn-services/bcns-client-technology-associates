// Expense list (/expenses): read-only. Type names come from one tblexptype read, never one per row.
import type { Db } from "@/lib/time/entries";

export type ExpenseListRow = {
  expid: number;
  expdate: string;
  typeName: string;
  expdscr: string | null;
  expchecknum: number | null;
  amount: string;
  expclearedbank: boolean | null;
};
export type ExpenseList = { rows: ExpenseListRow[]; totalCents: number; total: string };
export type ExpenseFilter = { caseId: number | null; month: string | null };

const PAGE = 1000; // PostgREST max-rows on the hosted project; page so "every expense" really is every one

/** `?case=` → case number or null. */
export const parseCase = (raw: string | undefined): number | null => (raw && /^\d{1,9}$/.test(raw) ? Number(raw) : null);

/** `?month=yyyy-mm` → that month; junk/empty → null. */
export const parseMonth = (raw: string | undefined): string | null => (raw && /^\d{4}-(0[1-9]|1[0-2])$/.test(raw) ? raw : null);

/** First/last day of yyyy-mm as strings, no Date. */
export function monthBounds(ym: string): [string, string] {
  const y = Number(ym.slice(0, 4)), m = Number(ym.slice(5, 7));
  const leap = (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
  const last = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1];
  return [`${ym}-01`, `${ym}-${String(last)}`];
}

/** numeric(12,2) → integer cents (|cents| ≤ 1e12, exact in a double). */
export const toCents = (v: number | string): number => Math.round(Number(v) * 100);

export function fmtCents(c: number): string {
  const abs = Math.abs(c);
  return `${c < 0 ? "-" : ""}${Math.trunc(abs / 100).toLocaleString("en-US")}.${String(abs % 100).padStart(2, "0")}`;
}

/** Filters: case only → all of that case's expenses; otherwise the month (firm-wide rows included), plus the case if given. */
export async function listExpenses(db: Db, f: ExpenseFilter): Promise<ExpenseList> {
  const page = async (from: number, count: boolean) => {
    let q = db.from("tblexpenses").select("expid, expdate, exptype, expdscr, expchecknum, expamount, expclearedbank", count ? { count: "exact" } : undefined);
    if (f.caseId != null) q = q.eq("expcaseid", f.caseId);
    if (f.month) {
      const [first, last] = monthBounds(f.month);
      q = q.gte("expdate", first).lte("expdate", last);
    }
    const res = await q.order("expdate").order("expid").range(from, from + PAGE - 1);
    if (res.error) throw new Error(`tblexpenses list: ${res.error.message}`);
    return res as { data: any[] | null; count: number | null };
  };
  // Types and the first page (with the exact total count) together, then every remaining page in parallel.
  const [types, head] = await Promise.all([db.from("tblexptype").select("exptypeid, exptype"), page(0, true)]);
  if (types.error) throw new Error(`tblexptype list: ${types.error.message}`);
  const typeName = new Map<number, string>((types.data ?? []).map((t: { exptypeid: number; exptype: string }) => [t.exptypeid, t.exptype]));
  const rest: number[] = [];
  for (let from = PAGE; from < (head.count ?? 0); from += PAGE) rest.push(from);
  const raw: any[] = [head, ...(await Promise.all(rest.map((from) => page(from, false))))].flatMap((p) => p.data ?? []);

  let totalCents = 0;
  const rows = raw.map((r): ExpenseListRow => {
    const c = toCents(r.expamount);
    totalCents += c;
    return {
      expid: r.expid, expdate: r.expdate, expdscr: r.expdscr, expchecknum: r.expchecknum, expclearedbank: r.expclearedbank,
      typeName: r.exptype == null ? "" : typeName.get(r.exptype) ?? `#${r.exptype}`,
      amount: fmtCents(c),
    };
  });
  return { rows, totalCents, total: fmtCents(totalCents) };
}
