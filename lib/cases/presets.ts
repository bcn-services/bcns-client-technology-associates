/**
 * Case presets (legacy Access queries): Work Status, Waiting For, Other experts, Recent activity.
 * Read-only — select-style PostgREST calls on tblcase / tblfundsrcvd / tblsrvauth only.
 * Reads tblcase directly (hosted DB may lack the case_search view).
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/db/types";
import { escapeLike, orElement } from "./search";

type Db = SupabaseClient<Database>;
type Loose = SupabaseClient;
export type Result<T> = { rows: T[] } | { error: string };

class QueryError extends Error {}

/** Every row of a query, 1000 per request (PostgREST's default max). `build` must apply its own order. */
async function all<T>(build: () => any, table: string): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await build().range(from, from + 999);
    if (error) {
      console.error(`case presets: ${table}: ${error.message}`);
      throw new QueryError();
    }
    out.push(...(data as T[]));
    if (data.length < 1000) return out;
  }
}

async function guard<T>(what: string, fn: () => Promise<T[]>): Promise<Result<T>> {
  try {
    return { rows: await fn() };
  } catch (e) {
    if (e instanceof QueryError) return { error: `Couldn't load ${what}. Try again, or contact support if it keeps happening.` };
    throw e;
  }
}

const cmp = (a: string | number, b: string | number) => (a < b ? -1 : a > b ? 1 : 0);

// ---------- Work Status ----------

export const POINT_MEN = ["IUO", "KJS", "RMD", "JH", "Oren", "RC", "LLB"] as const;
export type WorkStatusSort = "due" | "priority";
export type WorkStatusRow = {
  caseid: number;
  casetitle: string;
  casestatpriority: string | null;
  casestatpointman: string | null;
  casestatduedate: string | null;
  casestatduedatedescription: string | null;
  casestatdescription: string | null;
  casestatwaitingfor: string | null;
};

/** A point man from the legacy picker list, else "" (= all). */
export function normalizePointMan(v: string | undefined): string {
  const t = (v ?? "").trim();
  return POINT_MEN.find((p) => p.toLowerCase() === t.toLowerCase()) ?? "";
}

/**
 * Legacy "Work Status query": priority not null and not LIKE "*9*" (substring, not "!= 9"), and point man
 * contains the target or is null. sort "due" = due date present first (legacy), then due date, then case #;
 * "priority" = legacy COPY, priority text case-insensitively, then case #.
 */
export function workStatus(db: Db, pointMan: string, sort: WorkStatusSort): Promise<Result<WorkStatusRow>> {
  const d = db as unknown as Loose;
  const pm = normalizePointMan(pointMan);
  return guard("work status", async () => {
    const rows = await all<WorkStatusRow>(() => {
      let q = d.from("tblcase")
        .select("caseid, casetitle, casestatpriority, casestatpointman, casestatduedate, casestatduedatedescription, casestatdescription, casestatwaitingfor")
        .not("casestatpriority", "is", null)
        .not("casestatpriority", "like", "%9%");
      // Blank target: legacy Like "**" matches every non-null point man, plus nulls = all rows.
      if (pm) q = q.or(`${orElement({ source: "case", column: "casestatpointman", op: "ilike", value: `%${escapeLike(pm)}%` })},casestatpointman.is.null`);
      return q.order("caseid");
    }, "tblcase");
    // Sorted here, not in SQL: PostgREST can't order by lower(text) or by "is null".
    // ponytail: whole matching set in memory — fine for active cases (hundreds); paginate if it grows.
    return rows.sort(sort === "priority"
      ? (a, b) => cmp((a.casestatpriority ?? "").toLowerCase(), (b.casestatpriority ?? "").toLowerCase()) || a.caseid - b.caseid
      : (a, b) => cmp(a.casestatduedate == null ? 1 : 0, b.casestatduedate == null ? 1 : 0)
        || cmp(a.casestatduedate ?? "", b.casestatduedate ?? "") || a.caseid - b.caseid);
  });
}

// ---------- Waiting For ----------

export const WAITING_FOR = ["Initial Advance and Initial Case Material", "Initial Advance", "Initial Case Material"] as const;
export type WaitingForRow = {
  caseid: number;
  casetitle: string;
  casestatwaitingfor: string;
  casestartdate: string;
  casestatduedate: string | null;
  casestatdescription: string | null;
  casestatduedatedescription: string | null;
  funds: number;
};

/** Legacy qryWaitingFor: the three waiting-for values (case-insensitive) with the sum of tblfundsrcvd.fndspmt (0 when none). */
export function waitingFor(db: Db): Promise<Result<WaitingForRow>> {
  const d = db as unknown as Loose;
  return guard("waiting-for cases", async () => {
    const cases = await all<Omit<WaitingForRow, "funds">>(() => d.from("tblcase")
      .select("caseid, casetitle, casestatwaitingfor, casestartdate, casestatduedate, casestatdescription, casestatduedatedescription")
      .or(WAITING_FOR.map((v) => orElement({ source: "case", column: "casestatwaitingfor", op: "ilike", value: escapeLike(v) })).join(","))
      .order("caseid"), "tblcase");
    if (!cases.length) return [];
    const cents = new Map<number, number>();
    // ponytail: one .in() with every waiting case id — fine for tens of cases; chunk if it reaches URL limits.
    const funds = await all<{ fndscaseid: number; fndspmt: number | string }>(() => d.from("tblfundsrcvd")
      .select("fndsid, fndscaseid, fndspmt").in("fndscaseid", cases.map((c) => c.caseid)).order("fndsid"), "tblfundsrcvd");
    for (const f of funds) cents.set(f.fndscaseid, (cents.get(f.fndscaseid) ?? 0) + Math.round(Number(f.fndspmt) * 100));
    return cases.map((c) => ({ ...c, funds: (cents.get(c.caseid) ?? 0) / 100 }));
  });
}

// ---------- Other experts ----------

export type OtherExpertsRow = { caseid: number; casetitle: string; otherexperts: string | null };

/** Legacy OtherExpertsSearch: case-insensitive substring of otherexperts, by case #. Blank term = no rows. */
export function otherExperts(db: Db, term: string): Promise<Result<OtherExpertsRow>> {
  const d = db as unknown as Loose;
  const t = term.trim();
  return guard("other experts", async () => (t
    ? all<OtherExpertsRow>(() => d.from("tblcase").select("caseid, casetitle, otherexperts")
      .ilike("otherexperts", `%${escapeLike(t)}%`).order("caseid"), "tblcase")
    : []));
}

// ---------- Recent activity ----------

export const ACTIVITY_DAYS = 35;
export type ActivityKind = "case_activity" | "sa" | "new_sa";
export type ActivityRow = { kind: ActivityKind; caseid: number; actionDate: string; description: string; srvauthid: number | null };
const KIND_RANK: Record<ActivityKind, number> = { case_activity: 0, sa: 1, new_sa: 2 };

/** today (YYYY-MM-DD) minus 35 days. */
export function activityCutoff(today: string): string {
  const t = new Date(`${today}T00:00:00Z`);
  t.setUTCDate(t.getUTCDate() - ACTIVITY_DAYS);
  return t.toISOString().slice(0, 10);
}

/** Today's date where the firm is (Hartford), for the page to pass in. */
export function firmToday(now: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(now);
}

const s = (v: unknown) => (v == null ? "" : String(v));

/**
 * The three case-lane sources of legacy Query_DatabaseActivity, each `date > today - 35` (strict).
 * Newest first; ties by source (status, approval, new SA), case #, srvauthid. `today` is injected.
 * ponytail: the cutoff date is compared to timestamptz in the DB session zone (UTC on Supabase), not Hartford midnight.
 */
export function recentActivity(db: Db, today: string): Promise<Result<ActivityRow>> {
  const d = db as unknown as Loose;
  const cutoff = activityCutoff(today);
  return guard("recent activity", async () => {
    type C = { caseid: number; casetitle: string; casestatpriority: string | null; casestatdescription: string | null; casestatlastupdated: string };
    type S = { srvauthid: number; srvauthcaseid: number; srvauthstatus: string; srvauthdate: string; srvdateapproved: string };
    const [cases, approved, created] = await Promise.all([
      all<C>(() => d.from("tblcase").select("caseid, casetitle, casestatpriority, casestatdescription, casestatlastupdated")
        .gt("casestatlastupdated", cutoff).order("caseid"), "tblcase"),
      all<S>(() => d.from("tblsrvauth").select("srvauthid, srvauthcaseid, srvauthstatus, srvdateapproved")
        .gt("srvdateapproved", cutoff).order("srvauthid"), "tblsrvauth"),
      all<S>(() => d.from("tblsrvauth").select("srvauthid, srvauthcaseid, srvauthdate")
        .gt("srvauthdate", cutoff).order("srvauthid"), "tblsrvauth"),
    ]);
    const rows: ActivityRow[] = [
      ...cases.map((c) => ({ kind: "case_activity" as const, caseid: c.caseid, actionDate: c.casestatlastupdated, srvauthid: null,
        description: `Case Status Update for Case#${c.caseid} (${s(c.casetitle)}) Priority  ${s(c.casestatpriority)}::${s(c.casestatdescription)}` })),
      ...approved.map((a) => ({ kind: "sa" as const, caseid: a.srvauthcaseid, actionDate: a.srvdateapproved, srvauthid: a.srvauthid,
        description: `Service Authorization ${s(a.srvauthstatus)} for Case#${a.srvauthcaseid}` })),
      ...created.map((a) => ({ kind: "new_sa" as const, caseid: a.srvauthcaseid, actionDate: a.srvauthdate, srvauthid: a.srvauthid,
        description: `New Service Authorization for Case#${a.srvauthcaseid}` })),
    ];
    // Bare dates parse as UTC midnight, matching a date -> timestamptz cast in a UTC session.
    return rows.sort((a, b) => Date.parse(b.actionDate) - Date.parse(a.actionDate)
      || KIND_RANK[a.kind] - KIND_RANK[b.kind] || a.caseid - b.caseid || (a.srvauthid ?? 0) - (b.srvauthid ?? 0));
  });
}

/** First value of a Next searchParam (repeated keys arrive as arrays). */
export function param(v: string | string[] | undefined): string {
  return (Array.isArray(v) ? v[0] : v) ?? "";
}
