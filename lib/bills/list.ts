import type { Db } from "@/lib/time/entries";
import { requireSession, type Session, type SessionClient } from "@/lib/auth/session";
import { firmToday } from "@/lib/cases/presets";
import { OPEN_NOTICES, canSendNotice, daysSinceNotice, isDue, isNoticeStage, lastNoticeDate, noticeBlockCode } from "./rules";
import { loadBillOutput, type BillOutput } from "./output";

export type OpenBillRow = {
  billid: number;
  caseNumber: number;
  filename: string | null;
  billdate: string;
  balance: number;
  lastNotice: string;
  days: number;
  due: boolean;
  /** canSendNotice: a 2nd / Final bill with its invoice PDF stored. */
  sendNotice: boolean;
  /** A 2nd / Final bill that can't have its notice sent: why (a lib/bills/send message code); else null. */
  noticeWhy: string | null;
  /** Typed bills, when loaded with `output`: state + Download / Finalize / Send (lib/bills/output). Legacy: null. */
  output?: BillOutput | null;
};
export type BillGroup = { stage: string; rows: OpenBillRow[] };

const STAGES = [...OPEN_NOTICES];
const COLS = "billid, billcaseid, billdate, billbalance, billfilename, billnotice, billsecondnoticedate, billfinalnoticedate, billtype, billhours, billfinalizedat, billpdfpath, billsentat, tblcase(caseid)";

/**
 * Open bills grouped by stage (OPEN_NOTICES order), most days since last notice first. One query, read-only; with
 * `output` (the /bills page) each typed bill also gets its bill output, which for an admin costs two batched reads.
 */
export async function loadOpenBills(db: Db, today: string, output?: { admin: boolean }): Promise<BillGroup[]> {
  const { data, error } = await db.from("tblbills").select(COLS).in("billnotice", [...OPEN_NOTICES]);
  if (error) throw new Error(`tblbills: ${error.message}`);
  const out = output ? await loadBillOutput(db, data ?? [], output.admin) : null;
  // The query filter is the only open-status guard; grouping keeps whatever it returns (no second, masking filter).
  const groups = new Map<string, OpenBillRow[]>();
  for (const b of data ?? []) {
    if (!groups.has(b.billnotice)) groups.set(b.billnotice, []);
    groups.get(b.billnotice)!.push({
      billid: b.billid,
      caseNumber: b.tblcase?.caseid ?? b.billcaseid,
      filename: b.billfilename,
      billdate: String(b.billdate).slice(0, 10),
      balance: Number(b.billbalance),
      lastNotice: lastNoticeDate(b),
      days: daysSinceNotice(b, today),
      due: isDue(b, today),
      sendNotice: canSendNotice(b),
      noticeWhy: isNoticeStage(b.billnotice) && !canSendNotice(b) ? noticeBlockCode(b) : null,
      ...(out ? { output: out.get(b.billid) ?? null } : {}),
    });
  }
  const rank = (s: string) => { const i = STAGES.indexOf(s); return i < 0 ? STAGES.length : i; };
  return [...groups]
    .sort(([a], [b]) => rank(a) - rank(b))
    .map(([stage, rows]) => ({ stage, rows: rows.sort((x, y) => y.days - x.days || x.billid - y.billid) }));
}

/** The `/bills?due=1` list and the dashboard's Due tile: open bills past their due date (`isDue`), empty stages dropped. */
export const dueOnly = (groups: BillGroup[]): BillGroup[] =>
  groups.map((g) => ({ ...g, rows: g.rows.filter((r) => r.due) })).filter((g) => g.rows.length > 0);

/**
 * Page entry point: any signed-in role (staff included) may read; `client`/`now` injected by tests. The page passes its
 * own requireSession() promise as `session`, so one auth check serves both the page and this read.
 */
export async function runBillsList(deps: { db: Db; now: Date; client?: SessionClient | null; session?: Promise<Session>; dueOnly?: boolean }): Promise<BillGroup[]> {
  const session = await (deps.session ?? requireSession(undefined, deps.client));
  const groups = await loadOpenBills(deps.db, firmToday(deps.now), { admin: session.role === "admin" });
  return deps.dueOnly ? dueOnly(groups) : groups;
}
