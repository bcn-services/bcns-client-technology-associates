/**
 * Dashboard data: the legacy Work Status Sheet plus a header of counts.
 * Composes only — every number comes from the same lib call the tile's link lands on:
 * `loadOpenBills` (which applies OPEN_NOTICES / lastNoticeDate / isDue), `waitingFor` and `workStatus`.
 * No due window, open-notice list or priority filter is re-derived here.
 */
import type { Db } from "@/lib/time/entries";
import { loadOpenBills } from "@/lib/bills/list";
import { firmToday, waitingFor, workStatus, type WorkStatusRow } from "@/lib/cases/presets";

/** The client type `lib/cases/presets.ts` takes — distinct alias from `Db`, so call sites cast. */
type CaseDb = Parameters<typeof waitingFor>[0];

export type Tile = { key: string; label: string; href: string; count: number | null };
export type Dashboard = { tiles: Tile[]; rows: WorkStatusRow[]; error: string | null };

/** The work-status list this dashboard mirrors: every case for the blank point man, priority order. */
export const WORK_STATUS_HREF = "/cases/lists/work-status?sort=priority";

/** Overdue = a work-status case whose target date has already passed. Compared as yyyy-mm-dd strings. */
const isPast = (r: WorkStatusRow, today: string) => r.casestatduedate != null && String(r.casestatduedate).slice(0, 10) < today;

export async function loadDashboard(db: Db, now: Date): Promise<Dashboard> {
  const today = firmToday(now);
  const cdb = db as unknown as CaseDb;
  const [groups, waiting, work] = await Promise.all([
    loadOpenBills(db, today),
    waitingFor(cdb),
    workStatus(cdb, "", "priority"),
  ]);
  const bills = groups.flatMap((g) => g.rows);
  const rows = "error" in work ? [] : work.rows;
  const tiles: Tile[] = [
    { key: "due", label: "Due", href: "/bills", count: bills.filter((b) => b.due).length },
    { key: "overdue", label: "Overdue", href: WORK_STATUS_HREF, count: "error" in work ? null : rows.filter((r) => isPast(r, today)).length },
    { key: "waiting", label: "Waiting", href: "/cases/lists/waiting-for", count: "error" in waiting ? null : waiting.rows.length },
    { key: "unpaid", label: "Unpaid", href: "/bills", count: bills.length },
  ];
  return { tiles, rows, error: "error" in work ? work.error : null };
}
