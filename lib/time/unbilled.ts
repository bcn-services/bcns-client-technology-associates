/** Admin "Unbilled hours by case": unbilled := actbilled = false AND actbillid is null, both in the query. */
import type { Db } from "./entries";
import { fmtHours, thousandths } from "./week";

export type UnbilledCase = { caseid: number; casetitle: string; hours: string };

const PAGE = 1000; // PostgREST max-rows default; page until a short page comes back

export async function unbilledByCase(db: Db): Promise<UnbilledCase[]> {
  const sums = new Map<number, { casetitle: string; t: number }>();
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await db
      .from("tblactivity")
      .select("actid, actcaseid, acthrs, tblcase(casetitle)")
      .eq("actbilled", false)
      .is("actbillid", null)
      .order("actid", { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`tblactivity unbilled read: ${error.message}`);
    const rows = (data ?? []) as { actcaseid: number; acthrs: number | string; tblcase: { casetitle: string } | null }[];
    for (const r of rows) {
      const s = sums.get(r.actcaseid) ?? { casetitle: r.tblcase?.casetitle ?? "", t: 0 };
      s.t += thousandths(r.acthrs);
      sums.set(r.actcaseid, s);
    }
    if (rows.length < PAGE) break;
  }
  // ponytail: sums in JS over every unbilled row — move to a SQL view/RPC if unbilled rows reach six figures
  return [...sums]
    .filter(([, s]) => s.t !== 0)
    .sort(([a], [b]) => a - b)
    .map(([caseid, s]) => ({ caseid, casetitle: s.casetitle, hours: fmtHours(s.t) }));
}
