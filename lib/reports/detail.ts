/**
 * Detail-list report engine (/reports): read-only date-range reads behind the legacy Monthly Expense Report
 * and Monthly Income Report. The same engine, with filters applied, is the `2025_All_Consultants` and
 * `2025_Liberum_Advisors_Fees` cuts. No insert/update/delete is issued from this module.
 *
 * Session: `requireSession()` stays at the page entry point, run via `Promise.all([requireSession(), <query>])`
 * exactly as `app/expenses/page.tsx:18` does — no lib query module in this codebase calls it.
 * Callers pass `createServerClient() as unknown as Db` (the `@/lib/time/entries` structural `Db`).
 */
import type { Db } from "@/lib/time/entries";
import { fmtCents, toCents } from "@/lib/expenses/list";
import { escapeLike } from "@/lib/cases/search";

const PAGE = 1000; // PostgREST max-rows on the hosted project; page so "the whole range" really is the whole range

/** Inclusive `yyyy-mm-dd` range, plus the three optional cuts. A null/undefined filter is "no filter". */
export type DetailFilter = {
  start: string;
  end: string;
  /** `tblexptype.exptypeid`. Never gated on `tblexptype.active`: retired types still own historical rows. */
  exptype?: number | null;
  /** Case-insensitive substring over the vendor/description column (`expdscr` / `fndsdesc`). */
  description?: string | null;
  /** `expbranch` / `fndsbranch`, matched exactly. */
  branch?: string | null;
};

export type ExpenseDetailRow = {
  expid: number;
  expdate: string;
  exptype: number | null;
  typeName: string;
  initials: string;
  expdscr: string | null;
  expreason: string | null;
  expchecknum: number | null;
  amountCents: number;
  amount: string;
};

export type ExpenseTypeSummary = {
  exptype: number | null;
  typeName: string;
  count: number;
  totalCents: number;
  total: string;
};

export type ExpenseDetail = {
  rows: ExpenseDetailRow[];
  /** One entry per type with at least one row in the period — nothing else. */
  summary: ExpenseTypeSummary[];
  totalCents: number;
  total: string;
};

export type IncomeDetailRow = {
  fndsid: number;
  fndsdate: string;
  attorney: string;
  fndsdesc: string | null;
  fndscaseid: number | null;
  amountCents: number;
  amount: string;
  fndspayee: string | null;
  fndsbranch: string;
};

export type IncomeDetail = { rows: IncomeDetailRow[]; totalCents: number; total: string };

type Page = { data: any[] | null; count: number | null };

/**
 * Count-first, then every remaining page in parallel — idiom A (`lib/expenses/list.ts:42-59`), not the
 * sequential `all()` of `lib/cases/presets.ts:17-28`. Chosen because a full-year report is the slow case
 * and its pages are independent: one exact count then N concurrent reads beats N serial round trips.
 */
async function pageAll(build: (count: boolean) => any, label: string): Promise<any[]> {
  const read = async (from: number, count: boolean): Promise<Page> => {
    const res = await build(count).range(from, from + PAGE - 1);
    if (res.error) throw new Error(`${label}: ${res.error.message}`);
    return res as Page;
  };
  const head = await read(0, true);
  const rest: number[] = [];
  for (let from = PAGE; from < (head.count ?? 0); from += PAGE) rest.push(from);
  return [head, ...(await Promise.all(rest.map((from) => read(from, false))))].flatMap((p) => p.data ?? []);
}

const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** Applied after assembly, not left to `.order()`: page concatenation must not decide row order. */
const byDate = <T extends { [k: string]: any }>(rows: T[], dateKey: string, idKey: string): T[] =>
  rows.sort((a, b) => cmp(String(a[dateKey]), String(b[dateKey])) || Number(a[idKey]) - Number(b[idKey]));

/**
 * Monthly Expense Report rows (date, type, initials, description, reason, check #, amount) for an inclusive
 * date range, plus a per-type summary covering only the types with activity in that range.
 * Rows with a null `expcaseid` are firm-wide expenses and are included.
 */
export async function expenseDetail(db: Db, f: DetailFilter): Promise<ExpenseDetail> {
  const build = (count: boolean) => {
    let q = db
      .from("tblexpenses")
      .select("expid, expdate, exptype, expinit, expdscr, expreason, expchecknum, expamount", count ? { count: "exact" } : undefined)
      .gte("expdate", f.start)
      .lte("expdate", f.end);
    if (f.exptype != null) q = q.eq("exptype", f.exptype);
    if (f.branch) q = q.eq("expbranch", f.branch);
    if (f.description) q = q.ilike("expdscr", `%${escapeLike(f.description)}%`);
    return q.order("expdate").order("expid");
  };
  // No `active` filter on tblexptype: `active` gates the picker, never the report (and it is nullable).
  const [raw, types, names] = await Promise.all([
    pageAll(build, "tblexpenses detail"),
    db.from("tblexptype").select("exptypeid, exptype"),
    db.from("tblbillingnames").select("personid, initials"),
  ]);
  if (types.error) throw new Error(`tblexptype read: ${types.error.message}`);
  if (names.error) throw new Error(`tblbillingnames read: ${names.error.message}`);
  const typeName = new Map<number, string>((types.data ?? []).map((t: { exptypeid: number; exptype: string }) => [t.exptypeid, t.exptype]));
  const initials = new Map<number, string>((names.data ?? []).map((n: { personid: number; initials: string }) => [n.personid, n.initials]));

  const rows = byDate(raw, "expdate", "expid").map((r): ExpenseDetailRow => {
    const amountCents = toCents(r.expamount);
    return {
      expid: r.expid,
      expdate: r.expdate,
      exptype: r.exptype ?? null,
      typeName: r.exptype == null ? "" : typeName.get(r.exptype) ?? `#${r.exptype}`,
      initials: (r.expinit != null && initials.get(r.expinit)) || "",
      expdscr: r.expdscr ?? null,
      expreason: r.expreason ?? null,
      expchecknum: r.expchecknum ?? null,
      amountCents,
      amount: fmtCents(amountCents),
    };
  });

  // Summary is folded from the returned rows, so it can never disagree with them and never names a quiet type.
  const byType = new Map<string, ExpenseTypeSummary>();
  let totalCents = 0;
  for (const r of rows) {
    totalCents += r.amountCents;
    const key = String(r.exptype);
    const s = byType.get(key) ?? { exptype: r.exptype, typeName: r.typeName, count: 0, totalCents: 0, total: "" };
    s.count += 1;
    s.totalCents += r.amountCents;
    byType.set(key, s);
  }
  const summary = [...byType.values()]
    .map((s) => ({ ...s, total: fmtCents(s.totalCents) }))
    .sort((a, b) => cmp(a.typeName, b.typeName) || (a.exptype ?? -1) - (b.exptype ?? -1));

  return { rows, summary, totalCents, total: fmtCents(totalCents) };
}

/**
 * Monthly Income Report rows (date, attorney, description, case #, amount, payee, branch) for an inclusive
 * date range. Rows with a null `fndscaseid` are firm-wide receipts and are included, with a blank attorney.
 */
export async function incomeDetail(db: Db, f: DetailFilter): Promise<IncomeDetail> {
  const build = (count: boolean) => {
    let q = db
      .from("tblfundsrcvd")
      .select("fndsid, fndsdate, fndspmt, fndspayee, fndsdesc, fndsbranch, fndscaseid", count ? { count: "exact" } : undefined)
      .gte("fndsdate", f.start)
      .lte("fndsdate", f.end);
    if (f.branch) q = q.eq("fndsbranch", f.branch);
    if (f.description) q = q.ilike("fndsdesc", `%${escapeLike(f.description)}%`);
    return q.order("fndsdate").order("fndsid");
  };
  const [raw, cases, attys] = await Promise.all([
    pageAll(build, "tblfundsrcvd detail"),
    // ponytail: two full lookup reads, paged — swap for an `.in()` on the ids actually present if these tables ever dwarf the range.
    pageAll((count) => db.from("tblcase").select("caseid, caseatty", count ? { count: "exact" } : undefined).order("caseid"), "tblcase read"),
    pageAll((count) => db.from("tblattorney").select("attyid, attylastname, attyfirstname", count ? { count: "exact" } : undefined).order("attyid"), "tblattorney read"),
  ]);
  const attyOf = new Map<number, number>(cases.map((c: any) => [c.caseid, c.caseatty]));
  const attyName = new Map<number, string>(attys.map((a: any) => [a.attyid, `${a.attylastname ?? ""}, ${a.attyfirstname ?? ""}`]));

  let totalCents = 0;
  const rows = byDate(raw, "fndsdate", "fndsid").map((r): IncomeDetailRow => {
    const amountCents = toCents(r.fndspmt);
    totalCents += amountCents;
    const atty = r.fndscaseid == null ? undefined : attyOf.get(r.fndscaseid);
    return {
      fndsid: r.fndsid,
      fndsdate: r.fndsdate,
      attorney: (atty != null && attyName.get(atty)) || "",
      fndsdesc: r.fndsdesc ?? null,
      fndscaseid: r.fndscaseid ?? null,
      amountCents,
      amount: fmtCents(amountCents),
      fndspayee: r.fndspayee ?? null,
      fndsbranch: r.fndsbranch,
    };
  });
  return { rows, totalCents, total: fmtCents(totalCents) };
}
