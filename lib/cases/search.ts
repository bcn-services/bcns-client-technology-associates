/**
 * Case search and lists. Predicate building is pure (a Spec of Preds); runSearch/listCases
 * turn a Spec into PostgREST calls. Tests render the same Spec as SQL against local Postgres.
 *
 * Sources: `view` = case_search (LEFT JOINs, so orphan cases stay visible; widened in 0011 with
 * subject/status/priority/point man/waiting for/description/event description); `case` = tblcase,
 * which advanced search still uses for subject, status and start date.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/db/types";

export type Source = "view" | "case";
export type Op = "ilike" | "eq" | "gt";
export type Pred = { source: Source; column: string; op: Op; value: string };
export type Spec = { mode: "and" | "or"; preds: Pred[] };
export type CaseRow = {
  caseid: number;
  casetitle: string;
  status: string | null;
  casestartdate: string | null;
  attyname: string | null;
  clientname: string | null;
  frmname: string | null;
};
export type SearchResult = { rows: CaseRow[]; more: boolean } | { error: string };

export const LIMIT = 200;

/** Escape LIKE metacharacters so user-typed `%`, `_`, `\` match literally (backslash is ILIKE's default escape). */
export function escapeLike(s: string): string {
  return s.replace(/[\\%_]/g, "\\$&");
}
const contains = (s: string) => `%${escapeLike(s)}%`;

/** Quick search: substring OR across the view's text columns; an all-digit term also matches case # exactly. */
export const QUICK_COLUMNS = [
  "casetitle", "casenotes", "casecaption", "attyname", "attyemail", "attyphone",
  "frmname", "frmphone", "clientname", "otherexperts",
  "casesubject", "status", "casestatpriority", "casestatpointman", "casestatwaitingfor",
  "casestatdescription", "casestatduedatedescription",
] as const;

export function quickSpec(q: string): Spec | null {
  const term = q.trim();
  if (!term) return null;
  const preds: Pred[] = QUICK_COLUMNS.map((column) => ({ source: "view", column, op: "ilike", value: contains(term) }));
  // ponytail: case # matches exactly, not as a substring — PostgREST can't ilike an integer column and
  // the view has no caseid::text column; add one via a foundation amendment if substring case # is wanted.
  if (/^\d{1,9}$/.test(term)) preds.unshift({ source: "view", column: "caseid", op: "eq", value: String(Number(term)) });
  return { mode: "or", preds };
}

/** Advanced search fields, per legacy frmSearchInput. */
export const ADVANCED_FIELDS = [
  { key: "caseid", label: "Case #", source: "view", column: "caseid", kind: "number" },
  { key: "title", label: "Title", source: "view", column: "casetitle", kind: "text" },
  { key: "subject", label: "Subject", source: "case", column: "casesubject", kind: "text" },
  { key: "notes", label: "Notes", source: "view", column: "casenotes", kind: "text" },
  { key: "status", label: "Status", source: "case", column: "status", kind: "exact" },
  { key: "priority", label: "Priority", source: "view", column: "casestatpriority", kind: "text" },
  { key: "pointman", label: "Point man", source: "view", column: "casestatpointman", kind: "text" },
  { key: "description", label: "Description", source: "view", column: "casestatdescription", kind: "text" },
  { key: "startdate", label: "Start date after", source: "case", column: "casestartdate", kind: "date" },
  { key: "attorney", label: "Attorney", source: "view", column: "attyname", kind: "text" },
  { key: "client", label: "Client", source: "view", column: "clientname", kind: "text" },
  { key: "firm", label: "Firm", source: "view", column: "frmname", kind: "text" },
  { key: "caption", label: "Caption", source: "view", column: "casecaption", kind: "text" },
] as const;
export type AdvancedKey = (typeof ADVANCED_FIELDS)[number]["key"];

export const NO_VALUES = "No search values selected";

/**
 * params: `<key>` = value, `mode` = "or" | anything else AND. Every field with a non-blank value
 * joins the predicate (legacy's tick-to-use checkboxes dropped: a filled box that was silently ignored
 * read as "no results").
 */
export function advancedSpec(params: Record<string, string | undefined>): { spec: Spec } | { message: string } {
  const preds: Pred[] = [];
  for (const f of ADVANCED_FIELDS) {
    const v = (params[f.key] ?? "").trim();
    if (!v) continue;
    if (f.kind === "number") {
      if (!/^\d{1,9}$/.test(v)) return { message: "Case # must be a whole number" };
      preds.push({ source: f.source, column: f.column, op: "eq", value: String(Number(v)) });
    } else if (f.kind === "date") {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(v) || Number.isNaN(Date.parse(v))) return { message: "Start date must be a date (YYYY-MM-DD)" };
      preds.push({ source: f.source, column: f.column, op: "gt", value: v });
    } else {
      // exact = case-insensitive equality: ilike with no wildcards.
      preds.push({ source: f.source, column: f.column, op: "ilike", value: f.kind === "exact" ? escapeLike(v) : contains(v) });
    }
  }
  if (!preds.length) return { message: NO_VALUES };
  return { spec: { mode: params.mode === "or" ? "or" : "and", preds } };
}

/** One PostgREST `or=(...)` element. The value is double-quoted so `,` `(` `)` `.` can't extend the filter. */
export function orElement(p: Pred): string {
  return `${p.column}.${p.op}."${p.value.replace(/[\\"]/g, "\\$&")}"`;
}

// Loose client: table names vary at runtime; row shapes are asserted at the edges.
type Db = SupabaseClient<Database>;
type Loose = SupabaseClient;
const TABLE: Record<Source, string> = { view: "case_search", case: "tblcase" };

/** Clear, non-crashing message when the view is absent or predates 0011 (missing column). */
export function describeError(where: string, e: { message: string; code?: string }): string {
  if (where === "case_search" && (e.code === "PGRST205" || e.code === "42P01" || /case_search/.test(e.message)))
    return "Case search is unavailable: the case_search view is missing or out of date in this database (migrations 0007/0011 not applied).";
  return `${where}: ${e.message}`;
}

class QueryError extends Error {}

async function ids(db: Loose, source: Source, mode: Spec["mode"], preds: Pred[], limit: number | null): Promise<number[]> {
  const out: number[] = [];
  // ponytail: AND across both sources pages every matching id (1000/request) and intersects in memory —
  // fine at tens of thousands of cases; move to an RPC if the table grows past that.
  for (let from = 0; ; from += 1000) {
    let q = db.from(TABLE[source]).select("caseid");
    if (mode === "or") q = q.or(preds.map(orElement).join(","));
    else for (const p of preds) q = q.filter(p.column, p.op, p.value);
    const to = limit == null ? from + 999 : limit;
    const { data, error } = await q.order("caseid").range(from, to);
    if (error) throw new QueryError(describeError(TABLE[source], error));
    out.push(...(data as { caseid: number }[]).map((r) => r.caseid));
    if (limit != null || data.length < 1000) return out;
  }
}

/** Case rows (tblcase) plus names (case_search) for the given ids, in the given order. */
async function hydrate(db: Loose, caseIds: number[]): Promise<CaseRow[]> {
  if (!caseIds.length) return [];
  const [cases, names] = await Promise.all([
    db.from("tblcase").select("caseid, casetitle, status, casestartdate").in("caseid", caseIds),
    db.from("case_search").select("caseid, attyname, clientname, frmname").in("caseid", caseIds),
  ]);
  if (cases.error) throw new QueryError(describeError("tblcase", cases.error));
  if (names.error) throw new QueryError(describeError("case_search", names.error));
  const byId = new Map((cases.data as CaseRow[]).map((c) => [c.caseid, c]));
  const nameById = new Map((names.data as CaseRow[]).map((n) => [n.caseid, n]));
  return caseIds.flatMap((id) => {
    const c = byId.get(id);
    if (!c) return [];
    const n = nameById.get(id);
    return [{ ...c, attyname: n?.attyname ?? null, clientname: n?.clientname ?? null, frmname: n?.frmname ?? null }];
  });
}

async function guard(fn: () => Promise<{ rows: CaseRow[]; more: boolean }>): Promise<SearchResult> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof QueryError) return { error: e.message };
    throw e;
  }
}

/** Matching cases ordered by case #, at most `limit` (more = there were further matches). */
export function runSearch(db: Db, spec: Spec, limit = LIMIT): Promise<SearchResult> {
  const d = db as unknown as Loose;
  return guard(async () => {
    const bySource = (s: Source) => spec.preds.filter((p) => p.source === s);
    const view = bySource("view");
    const kase = bySource("case");
    let matched: number[];
    if (!kase.length || !view.length) {
      matched = await ids(d, kase.length ? "case" : "view", spec.mode, spec.preds, limit);
    } else if (spec.mode === "or") {
      // The first limit+1 of a union lie within the first limit+1 of each side.
      const [a, b] = await Promise.all([ids(d, "view", "or", view, limit), ids(d, "case", "or", kase, limit)]);
      matched = [...new Set([...a, ...b])].sort((x, y) => x - y);
    } else {
      const [a, b] = await Promise.all([ids(d, "view", "and", view, null), ids(d, "case", "and", kase, null)]);
      const inB = new Set(b);
      matched = a.filter((id) => inB.has(id));
    }
    return { rows: await hydrate(d, matched.slice(0, limit)), more: matched.length > limit };
  });
}

export type ListKind = "newest" | "roster" | "titles";
export const LIST_KINDS: { kind: ListKind; label: string }[] = [
  { kind: "newest", label: "Newest first" },
  { kind: "roster", label: "Full roster (by case #)" },
  { kind: "titles", label: "Titles only" },
];
export const PAGE_SIZE = 100;

/** Case lists read tblcase directly (no joins), so a case with missing attorney/firm/client rows still lists. */
export function listCases(db: Db, kind: ListKind, page = 0): Promise<SearchResult> {
  const d = db as unknown as Loose;
  return guard(async () => {
    let q = d.from("tblcase").select("caseid");
    q = kind === "newest"
      ? q.order("casestartdate", { ascending: false }).order("caseid", { ascending: false })
      : kind === "titles" ? q.order("casetitle").order("caseid") : q.order("caseid");
    const from = page * PAGE_SIZE;
    const { data, error } = await q.range(from, from + PAGE_SIZE);
    if (error) throw new QueryError(describeError("tblcase", error));
    const all = (data as { caseid: number }[]).map((r) => r.caseid);
    return { rows: await hydrate(d, all.slice(0, PAGE_SIZE)), more: all.length > PAGE_SIZE };
  });
}

export type LabelAttorney = Pick<Database["public"]["Tables"]["tblattorney"]["Row"], "attytitle" | "attyfirstname" | "attymiddlename" | "attylastname" | "attysuffix" | "attyesq">;
export type LabelFirm = Pick<Database["public"]["Tables"]["tblfirm"]["Row"], "frmname" | "frmaddress1" | "frmaddress2" | "frmcity" | "frmstate" | "frmzip">;

/** Mailing label lines: attorney first-name-first, firm, street lines, "City, ST zip". Blank parts are dropped. */
export function labelLines(atty: LabelAttorney | null, firm: LabelFirm | null): string[] {
  const j = (sep: string, ...xs: (string | null | undefined)[]) => xs.map((x) => x?.trim()).filter(Boolean).join(sep);
  const name = atty
    ? j(", ", j(" ", atty.attyfirstname, atty.attymiddlename, atty.attylastname), atty.attysuffix, atty.attyesq ? "Esq." : null)
    : "";
  const cityLine = firm ? j(" ", j(", ", firm.frmcity, firm.frmstate), firm.frmzip) : "";
  return [name, firm?.frmname, firm?.frmaddress1, firm?.frmaddress2, cityLine].map((x) => x?.trim() ?? "").filter(Boolean);
}
