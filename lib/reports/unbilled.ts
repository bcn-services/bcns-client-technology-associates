/**
 * Unbilled work: the one definition behind the dashboard's Unbilled tile and the /unbilled page it links to.
 * Time := actbilled = false AND actbillid is null (same rule as lib/time/unbilled.ts and lib/bills/create.ts#loadNewBill, the rows Create Bill offers).
 * Expenses := on a case (expcaseid not null) AND expbillid is null (the only bill link tblexpenses has; billing sets no billed flag on expenses).
 */
import type { Db } from "@/lib/time/entries";

export type UnbilledTime = { actid: number; actcaseid: number; actdate: string; actdescription: string | null; acthrs: number | string };
export type UnbilledExpense = { expid: number; expcaseid: number; expdate: string; expdscr: string | null; expamount: number | string };
export type Unbilled = { time: UnbilledTime[]; expenses: UnbilledExpense[] };

const PAGE = 1000; // PostgREST max-rows default; page until a short page comes back

async function all<T>(label: string, page: (from: number, to: number) => PromiseLike<{ data: unknown; error: { message: string } | null }>): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await page(from, from + PAGE - 1);
    if (error) throw new Error(`${label}: ${error.message}`);
    const rows = (data ?? []) as T[];
    out.push(...rows);
    if (rows.length < PAGE) return out;
  }
}

export async function loadUnbilled(db: Db): Promise<Unbilled> {
  const [time, expenses] = await Promise.all([
    all<UnbilledTime>("tblactivity unbilled", (a, z) => db.from("tblactivity")
      .select("actid, actcaseid, actdate, actdescription, acthrs")
      .eq("actbilled", false).is("actbillid", null).order("actid", { ascending: true }).range(a, z)),
    all<UnbilledExpense>("tblexpenses unbilled", (a, z) => db.from("tblexpenses")
      .select("expid, expcaseid, expdate, expdscr, expamount")
      .not("expcaseid", "is", null).is("expbillid", null).order("expid", { ascending: true }).range(a, z)),
  ]);
  return { time, expenses };
}
