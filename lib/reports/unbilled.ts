/**
 * Unbilled work: the one definition behind the dashboard's Unbilled tile and the /unbilled page it links to.
 * Time := actbilled = false AND actbillid is null (same rule as lib/time/unbilled.ts and lib/bills/create.ts#loadNewBill, the rows Create Bill offers).
 * Expenses are left out until Create Bill claims them: nothing writes tblexpenses.expbillid, so every expense would stay "unbilled" forever.
 */
import type { Db } from "@/lib/time/entries";

export type UnbilledTime = { actid: number; actcaseid: number; actdate: string; actdescription: string | null; acthrs: number | string };

const PAGE = 1000; // PostgREST max-rows default; page until a short page comes back

/** The unbilled filter, shared by the tile's head count and the page's rows so they can't drift. */
const unbilledFilter = <Q extends { eq(c: string, v: boolean): Q; is(c: string, v: null): Q }>(q: Q): Q =>
  q.eq("actbilled", false).is("actbillid", null);

/** Tile: how many unbilled time entries exist (head count, no rows transferred). Throws on a read error. */
export async function countUnbilled(db: Db): Promise<number> {
  const { count, error } = await unbilledFilter(db.from("tblactivity").select("actid", { count: "exact", head: true }));
  if (error) throw new Error(`tblactivity unbilled count: ${error.message}`);
  return count ?? 0;
}

/** Page: every unbilled time entry. */
export async function loadUnbilled(db: Db): Promise<{ time: UnbilledTime[] }> {
  const time: UnbilledTime[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await unbilledFilter(db.from("tblactivity").select("actid, actcaseid, actdate, actdescription, acthrs"))
      .order("actid", { ascending: true }).range(from, from + PAGE - 1);
    if (error) throw new Error(`tblactivity unbilled: ${error.message}`);
    const rows = (data ?? []) as UnbilledTime[];
    time.push(...rows);
    if (rows.length < PAGE) return { time };
  }
}
