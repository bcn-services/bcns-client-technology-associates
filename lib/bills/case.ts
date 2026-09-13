/** Case page "Bills" panel: one case's tblbills rows, newest first. Read-only. */
import type { Db } from "@/lib/time/entries";

export type CaseBillRow = {
  billid: number;
  billdate: string;
  billtype: string | null;
  billbalance: number | string;
  billnotice: string;
  billsecondnoticedate: string | null;
  billfinalnoticedate: string | null;
};

/** Newest first: billdate desc, then billid desc (later insert wins a same-day tie). The panel relies on this order. */
export async function listCaseBills(db: Db, caseId: number): Promise<CaseBillRow[]> {
  // ponytail: one unpaged read (PostgREST max-rows 1000) — page it if a case ever passes 1000 bills
  const { data, error } = await db.from("tblbills")
    .select("billid, billdate, billtype, billbalance, billnotice, billsecondnoticedate, billfinalnoticedate")
    .eq("billcaseid", caseId)
    .order("billdate", { ascending: false })
    .order("billid", { ascending: false });
  if (error) throw new Error(`tblbills case read: ${error.message}`);
  return (data ?? []) as CaseBillRow[];
}
