/**
 * Inquiries (legacy tblinquiry): form parsing, changed-column diff, and the legacy searches.
 * Every DB function takes the client as a parameter so tests inject a fake.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Tables } from "../db/client";

export type Db = SupabaseClient<Database>;
export type InquiryRow = Tables<"tblinquiry">;

// From Access InquirySearchQuery, in its order: one OR'd Like "*k*" per field, ORDER BY ID.
export const QUICK_SEARCH_FIELDS = [
  "id", "inqdate", "inqcallername", "inqattyname", "inqfirm", "inqfirmlocation", "inqaccidentlocation",
  "inqrefferredby", "inqphonenumber", "inqemail", "inqdescription", "inqengineer", "inqsubject",
  "inqlocation", "inqhowheardaboutus", "inqcaption",
] as const;
// The text columns go through ilike; id (integer) and inqdate (date) can't, so they are matched in JS.
export const QUICK_SEARCH_TEXT = QUICK_SEARCH_FIELDS.filter((f) => f !== "id" && f !== "inqdate");

export const CALLER_TITLES = ["Attorney", "Paralegal", "Secretary", "Insurance Claims Rep", "Investigator"];
export const CLIENT_ROLES = ["Plaintiff", "Defendant", "Third Party", "Unknown", "Other (see notes)"];
export const ENGINEERS = ["Dr. Ojalvo", "Kris", "Lowell", "Oren", "Dr. Coppolino"];
export const HOW_HEARD = [
  "Legal Pages", "Unknown", "ALM Experts", "Bar Journal, CT", "Bar Journal, FL", "Bar Journal, NY", "ExpertPages",
  "Forensis Group", "Google", "Internet, unspecified", "JurisPro", "Previous Case", "TA website", "Yahoo", "SEAK",
];
export const SUBJECT_SUGGESTIONS = ["Low Speed", "Golf Cart", "Motor Vehicle", "Ladder", "Products", "Slip, Trip and Fall"];
export const DEFAULT_HOW_HEARD = "Unknown";
export const DEFAULT_ENGINEER = "Dr. Ojalvo";

/** Options for a value-list select: the list, plus the current value when it isn't in it (a migrated row keeps it). */
export const withCurrent = (list: string[], cur: string | null | undefined) =>
  cur && !list.some((x) => x.toLowerCase() === cur.toLowerCase()) ? [...list, cur] : list;

export const SENT_BOOLS = [
  "sentfee", "sentchecklist", "sentllb", "sentkjs", "sentiuo", "sentiuobio",
  "sentoren", "sentlarry", "sentcoppolino", "sentother1", "sentother2",
] as const;

const TEXT_FIELDS = [
  "inqsubject", "inqlocation", "tabranch", "inqrefferredby", "inqcallertitle", "inqcallername",
  "inqattyname", "inqfirm", "inqfirmlocation", "inqaccidentlocation", "inqdescription",
  "inqhowheardaboutus", "inqclient", "inqphonenumber", "inqaltphonenumber", "inqfaxnumber",
  "inqemail", "inqpreviouscase", "inqreceptionist", "inqengineer", "inqcaption",
  "sentbranch", "sentother1name", "sentother2name", "sentinfo1", "sentinfo2", "sentinfo3",
] as const;

// Everything the form writes. inqresultingcase is deliberately absent: read-only here.
export type InquiryValues = Omit<InquiryRow, "id" | "inqresultingcase">;
export type Result<T> = ({ ok: true } & T) | { ok: false; error: string };

/** Value-list match is case-insensitive; a known value is stored in its canonical casing, anything else as typed. */
const canonical = (v: string | null, list: string[]) =>
  v === null ? null : list.find((x) => x.toLowerCase() === v.toLowerCase()) ?? v;

export function parseInquiryForm(fd: FormData): Result<{ values: InquiryValues }> {
  const text = (k: string) => {
    const v = fd.get(k);
    return typeof v === "string" && v.trim() !== "" ? v.trim() : null;
  };
  const values = {} as Record<string, unknown>;
  for (const k of TEXT_FIELDS) values[k] = text(k);
  // Unchecked checkboxes are absent from FormData: absent must mean false, or unchecking never persists.
  for (const k of SENT_BOOLS) values[k] = fd.get(k) !== null;

  const date = text("inqdate");
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(date))) return { ok: false, error: "Date is required (YYYY-MM-DD)." };
  values.inqdate = date;

  const time = text("inqtime");
  if (time !== null && !/^\d{2}:\d{2}(:\d{2})?$/.test(time)) return { ok: false, error: "Time must be HH:MM." };
  values.inqtime = time === null ? null : time.length === 5 ? `${time}:00` : time; // matches Postgres' "HH:MM:SS" so the diff is stable

  const atty = text("inqattyid");
  if (atty !== null && !/^\d+$/.test(atty)) return { ok: false, error: "Attorney must be picked from the list." };
  values.inqattyid = atty === null ? null : Number(atty);

  values.inqcallertitle = canonical(values.inqcallertitle as string | null, CALLER_TITLES);
  values.inqclient = canonical(values.inqclient as string | null, CLIENT_ROLES);
  values.inqengineer = canonical(values.inqengineer as string | null, ENGINEERS);
  values.inqhowheardaboutus = canonical(values.inqhowheardaboutus as string | null, HOW_HEARD);
  return { ok: true, values: values as InquiryValues };
}

/** Only the columns whose parsed value differs from the loaded row. */
export function changedColumns(values: InquiryValues, row: InquiryRow): Partial<InquiryValues> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(values)) if (v !== (row as Record<string, unknown>)[k]) out[k] = v;
  return out as Partial<InquiryValues>;
}

export async function createInquiry(db: Db, fd: FormData): Promise<Result<{ id: number }>> {
  const p = parseInquiryForm(fd);
  if (!p.ok) return p;
  const { data, error } = await db.from("tblinquiry").insert(p.values).select("id").single();
  if (error) return { ok: false, error: `Could not create inquiry: ${error.message}` };
  return { ok: true, id: data.id };
}

export async function updateInquiry(db: Db, id: number, fd: FormData): Promise<Result<{ changed: string[] }>> {
  const p = parseInquiryForm(fd);
  if (!p.ok) return p;
  const { data: row, error: readError } = await db.from("tblinquiry").select("*").eq("id", id).maybeSingle();
  if (readError) return { ok: false, error: `Could not load inquiry: ${readError.message}` };
  if (!row) return { ok: false, error: "Inquiry not found." };
  const diff = changedColumns(p.values, row);
  const changed = Object.keys(diff);
  if (changed.length === 0) return { ok: true, changed };
  const { error } = await db.from("tblinquiry").update(diff).eq("id", id);
  if (error) return { ok: false, error: `Could not save inquiry: ${error.message}` };
  return { ok: true, changed };
}

// --- search ------------------------------------------------------------------

/** `%x%` ilike pattern with the user's `\`, `%`, `_` escaped so they match literally. */
export const likePattern = (input: string) => `%${input.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;

/** A value double-quoted for a PostgREST `.or()` string: commas, parens, and quotes in it stay data. */
export const orQuote = (v: string) => `"${v.replace(/[\\"]/g, (c) => `\\${c}`)}"`;

/** The quick-search `.or()`: every text field ilike the pattern, plus `id.in.(...)` for rows whose id/date matched in JS. */
// ponytail: PostgREST also treats `*` in like patterns as `%`, so a typed `*` broadens the match — harmless for search.
export const quickSearchFilter = (q: string, ids: number[] = []) =>
  [...QUICK_SEARCH_TEXT.map((c) => `${c}.ilike.${orQuote(likePattern(q))}`), ...(ids.length ? [`id.in.(${ids.join(",")})`] : [])].join(",");

/** Access shows dates as m/d/yyyy with no leading zeros. */
export const accessDate = (iso: string) => {
  const [y, m, d] = iso.split("-");
  return `${Number(m)}/${Number(d)}/${y}`;
};

/** Ids whose id or inqdate (ISO or m/d/yyyy) contains q — a literal, case-insensitive substring, like Access's Like "*k*". */
export function idDateMatches(rows: { id: number; inqdate: string | null }[], q: string): number[] {
  const k = q.toLowerCase();
  return rows
    .filter((r) => String(r.id).includes(k) || (r.inqdate != null && (r.inqdate.toLowerCase().includes(k) || accessDate(r.inqdate).includes(k))))
    .map((r) => r.id);
}

export const LIST_COLUMNS = "id, inqdate, inqcallername, inqattyname, inqfirm, inqsubject, tabranch, inqhowheardaboutus, inqresultingcase";
export type InquiryListRow = Pick<InquiryRow, "id" | "inqdate" | "inqcallername" | "inqattyname" | "inqfirm" | "inqsubject" | "tabranch" | "inqhowheardaboutus" | "inqresultingcase">;
// ponytail: result cap of 500 — add paging if staff ever need more than that from one search.
export const SEARCH_LIMIT = 500;

const list = (db: Db) => db.from("tblinquiry").select(LIST_COLUMNS);

async function rows(q: PromiseLike<{ data: unknown; error: { message: string } | null }>): Promise<InquiryListRow[]> {
  const { data, error } = await q;
  if (error) throw new Error(`tblinquiry search: ${error.message}`);
  return (data ?? []) as InquiryListRow[];
}

// ponytail: scans id/inqdate of up to ID_SCAN_LIMIT rows (and PostgREST max-rows) each search — upgrade to a view with a text column when a migration is allowed.
export const ID_SCAN_LIMIT = 10000;

export async function quickSearch(db: Db, q: string) {
  const { data, error } = await db.from("tblinquiry").select("id, inqdate").order("id").range(0, ID_SCAN_LIMIT - 1);
  if (error) throw new Error(`tblinquiry search: ${error.message}`);
  const ids = idDateMatches(data ?? [], q).slice(0, SEARCH_LIMIT);
  return rows(list(db).or(quickSearchFilter(q, ids)).order("id").limit(SEARCH_LIMIT));
}

export type DateMode = "between" | "onOrAfter" | "onOrBefore";
export type AdvancedParams = {
  attyname?: string; subject?: string; location?: string; branch?: string; referredby?: string;
  resultingcase?: string; dateMode?: DateMode; date1?: string; date2?: string;
};

/** Filter ops for a date mode: between → gte date1 AND lte date2; on-or-after → gte date1; on-or-before → lte date1. */
export function dateFilters(mode: DateMode | undefined, date1?: string, date2?: string): ["gte" | "lte", string][] {
  if (mode === "between") {
    const out: ["gte" | "lte", string][] = [];
    if (date1) out.push(["gte", date1]);
    if (date2) out.push(["lte", date2]);
    return out;
  }
  if (mode === "onOrAfter" && date1) return [["gte", date1]];
  if (mode === "onOrBefore" && date1) return [["lte", date1]];
  return [];
}

const ADVANCED_TEXT: [keyof AdvancedParams, string][] = [
  ["attyname", "inqattyname"], ["subject", "inqsubject"], ["location", "inqlocation"],
  ["branch", "tabranch"], ["referredby", "inqrefferredby"],
];

export async function advancedSearch(db: Db, p: AdvancedParams) {
  let q = list(db);
  for (const [param, col] of ADVANCED_TEXT) {
    const v = p[param]?.trim();
    if (v) q = q.ilike(col, likePattern(v));
  }
  // Resulting case is a smallint: wildcards don't apply, so it is an exact number match; non-numbers match nothing.
  const rc = p.resultingcase?.trim();
  if (rc) {
    if (!/^\d{1,5}$/.test(rc)) return [];
    q = q.eq("inqresultingcase", Number(rc));
  }
  for (const [op, d] of dateFilters(p.dateMode, p.date1?.trim(), p.date2?.trim())) q = op === "gte" ? q.gte("inqdate", d) : q.lte("inqdate", d);
  return rows(q.order("id").limit(SEARCH_LIMIT));
}

/** Preset: inquiries by attorney name, ordered by date. */
export function byAttorneyName(db: Db, name: string) {
  return rows(list(db).ilike("inqattyname", likePattern(name.trim())).order("inqdate").order("id").limit(SEARCH_LIMIT));
}

/** Preset: how heard about us, filtered by a typed source, ordered by id (legacy qryHowYouHeardAboutUs). */
export function byHowHeard(db: Db, source: string) {
  return rows(list(db).ilike("inqhowheardaboutus", likePattern(source.trim())).order("id").limit(SEARCH_LIMIT));
}

export function recentInquiries(db: Db) {
  return rows(list(db).order("id", { ascending: false }).limit(100));
}

// --- form options --------------------------------------------------------------

export type InquiryOptions = {
  branches: string[];
  attorneys: { id: number; name: string }[];
};

export async function loadInquiryOptions(db: Db): Promise<InquiryOptions> {
  const [b, a] = await Promise.all([
    db.from("tblbranches").select("branch").order("branch"),
    db.from("tblattorney").select("attyid, attyfirstname, attylastname").order("attylastname").order("attyfirstname"),
  ]);
  for (const [name, r] of [["tblbranches", b], ["tblattorney", a]] as const) {
    if (r.error) throw new Error(`${name}: ${r.error.message}`);
  }
  return {
    branches: (b.data ?? []).map((r) => r.branch),
    attorneys: (a.data ?? []).map((r) => ({ id: r.attyid, name: `${r.attylastname}, ${r.attyfirstname}` })),
  };
}

/** Today as YYYY-MM-DD in the server's local zone. */
export const todayIso = (now: Date = new Date()) =>
  `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
