/** Case page "Time" panel: one case's tblactivity rows, newest first, with initials from tblbillingnames. Read-only. */
import type { Db } from "./entries";
import { fmtHours, thousandths } from "./week";

export type CaseTimeRow = {
  actid: number;
  actdate: string;
  actdescription: string;
  acthrs: number | string;
  actwho: number | null;
  actbilled: boolean;
  actbillid: number | null;
  initials: string;
};

/** Newest first: actdate desc, then actid desc (later insert wins a same-day tie). */
export async function listCaseTime(db: Db, caseId: number): Promise<CaseTimeRow[]> {
  // No FK actwho → tblbillingnames, so no PostgREST embed: read both and join here (as app/time/week-view.tsx does).
  // ponytail: one unpaged read (PostgREST max-rows 1000) — page like lib/time/unbilled.ts if a case ever passes 1000 entries
  const [act, names] = await Promise.all([
    db.from("tblactivity")
      .select("actid, actdate, actdescription, acthrs, actwho, actbilled, actbillid")
      .eq("actcaseid", caseId)
      .order("actdate", { ascending: false })
      .order("actid", { ascending: false }),
    db.from("tblbillingnames").select("personid, initials"),
  ]);
  if (act.error) throw new Error(`tblactivity case read: ${act.error.message}`);
  if (names.error) throw new Error(`tblbillingnames read: ${names.error.message}`);
  const initials = new Map<number, string>((names.data ?? []).map((n: { personid: number; initials: string }) => [n.personid, n.initials]));
  return ((act.data ?? []) as Omit<CaseTimeRow, "initials">[]).map((r) => ({ ...r, initials: (r.actwho != null && initials.get(r.actwho)) || "" }));
}

/** Sum of unbilled rows ("2.000"); unbilled := actbilled = false AND actbillid is null — both tested. */
export function unbilledHours(rows: Pick<CaseTimeRow, "acthrs" | "actbilled" | "actbillid">[]): string {
  return fmtHours(rows.filter((r) => r.actbilled === false && r.actbillid == null).reduce((t, r) => t + thousandths(r.acthrs), 0));
}
