// Case-page funds panel: every tblfundsrcvd row on one case, reversal rows (negative fndsid, 'Bounced') included.
import type { Db } from "@/lib/time/entries";
import { fmtCents, toCents } from "@/lib/expenses/list";

export type CaseFundsRow = { fndsid: number; fndsdate: string; fndstype: string | null; fndspayee: string | null; amount: string; cleared: boolean };
export type CaseFunds = { rows: CaseFundsRow[]; total: string };

// ponytail: one unpaged read (PostgREST caps at 1000 rows) — page like listExpenses if a case ever nears that
export async function listCaseFunds(db: Db, caseId: number): Promise<CaseFunds> {
  const { data, error } = await db
    .from("tblfundsrcvd")
    .select("fndsid, fndsdate, fndstype, fndspayee, fndspmt, fndsclearedbank")
    .eq("fndscaseid", caseId)
    .order("fndsdate")
    .order("fndsid");
  if (error) throw new Error(`tblfundsrcvd case read: ${error.message}`);
  let cents = 0; // integer cents, never float addition of numerics
  const rows = ((data ?? []) as any[]).map((r): CaseFundsRow => {
    const c = toCents(r.fndspmt);
    cents += c;
    return { fndsid: r.fndsid, fndsdate: r.fndsdate, fndstype: r.fndstype, fndspayee: r.fndspayee, amount: fmtCents(c), cleared: r.fndsclearedbank === true };
  });
  return { rows, total: fmtCents(cents) };
}
