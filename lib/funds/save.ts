/**
 * Funds received (tblfundsrcvd): create, edit, read. No delete — corrections are edits (audit_log records them).
 * `fndspmt` is sent to PostgREST as the normalized decimal string from parseMoney, never a float.
 */
import type { Session } from "../auth/session";
import type { Db } from "../time/entries";
import { parseMoney } from "./money";

export class FundsError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = "FundsError";
  }
}

const MESSAGES: Record<string, string> = {
  case: "No case with that number.",
  amount: "Amount must be like 450.00 — at most 2 decimals, not zero.",
  date: "Date must be a valid date.",
  datecleared: "Date cleared must be a valid date (or blank).",
  notfound: "That funds record no longer exists.",
  forbidden: "You can't record funds.",
};
export const fundsErrorMessage = (code: string): string => MESSAGES[code] ?? "Save failed; nothing was recorded.";

/** Form field names, shared by the form, the actions and the error-echo query string. */
export const FUNDS_FIELDS = [
  "case", "amount", "date", "payee", "source", "type", "branch",
  "bankaccount", "description", "comment", "cleared", "datecleared", "clearingnotes",
] as const;
export type FundsValues = Record<(typeof FUNDS_FIELDS)[number], string>;

export const DEFAULT_BRANCH = "Stratford";

export type FundsRow = {
  fndsid: number; fndscaseid: number | null; fndsdate: string; fndspmt: number | string;
  fndspayee: string | null; fndssource: string | null; fndsdesc: string | null; fndsbranch: string;
  fndscomment: string | null; fndstype: string | null; fndsclearedbank: boolean | null;
  fndsdatecleared: string | null; fndsbankaccount: string | null; fndsclearingnotes: string | null;
};
const COLS = "fndsid, fndscaseid, fndsdate, fndspmt, fndspayee, fndssource, fndsdesc, fndsbranch, fndscomment, fndstype, fndsclearedbank, fndsdatecleared, fndsbankaccount, fndsclearingnotes";

const isDate = (s: string) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
};
const text = (v: string) => (v.trim() ? v.trim() : null);

/** Shape checks only (no DB). Order: case, amount, date — the first bad field is the one reported. */
export function parseFunds(get: (k: string) => string) {
  const rawCase = get("case").trim();
  if (!/^\d{1,9}$/.test(rawCase) || Number(rawCase) <= 0) throw new FundsError("case");
  const fndspmt = parseMoney(get("amount"));
  if (fndspmt == null) throw new FundsError("amount");
  const fndsdate = get("date").trim();
  if (!isDate(fndsdate)) throw new FundsError("date");
  const dc = get("datecleared").trim();
  if (dc && !isDate(dc)) throw new FundsError("datecleared");
  return {
    fndscaseid: Number(rawCase),
    fndspmt, // decimal string, e.g. "450.00"
    fndsdate,
    fndspayee: text(get("payee")),
    fndssource: text(get("source")),
    fndstype: text(get("type")),
    fndsbranch: text(get("branch")) ?? DEFAULT_BRANCH,
    fndsbankaccount: text(get("bankaccount")),
    fndsdesc: text(get("description")),
    fndscomment: text(get("comment")),
    fndsclearedbank: get("cleared") === "on" || get("cleared") === "true",
    fndsdatecleared: dc || null,
    fndsclearingnotes: text(get("clearingnotes")),
  };
}

async function requireCase(db: Db, caseid: number): Promise<void> {
  const found = await db.from("tblcase").select("caseid").eq("caseid", caseid).maybeSingle();
  if (found.error) throw new Error(`tblcase read: ${found.error.message}`);
  if (!found.data) throw new FundsError("case");
}

/** Validate, check the case exists, insert one row. Returns the new fndsid. */
export async function createFunds(db: Db, get: (k: string) => string): Promise<number> {
  const row = parseFunds(get);
  await requireCase(db, row.fndscaseid);
  const { data, error } = await db.from("tblfundsrcvd").insert(row).select("fndsid").single();
  if (error) throw new Error(`tblfundsrcvd insert: ${error.message}`);
  return data.fndsid;
}

/** Validate, check the case exists, overwrite the editable columns of one row (file-name columns untouched). */
export async function updateFunds(db: Db, fndsid: number, get: (k: string) => string): Promise<void> {
  const row = parseFunds(get);
  await requireCase(db, row.fndscaseid);
  const { data, error } = await db.from("tblfundsrcvd").update(row).eq("fndsid", fndsid).select("fndsid");
  if (error) throw new Error(`tblfundsrcvd update: ${error.message}`);
  if (!data?.length) throw new FundsError("notfound");
}

export async function loadFunds(db: Db, fndsid: number): Promise<FundsRow | null> {
  const { data, error } = await db.from("tblfundsrcvd").select(COLS).eq("fndsid", fndsid).maybeSingle();
  if (error) throw new Error(`tblfundsrcvd read: ${error.message}`);
  return data ?? null;
}

export type FundsListRow = Pick<FundsRow, "fndsid" | "fndsdate" | "fndscaseid" | "fndspayee" | "fndspmt">;
// ponytail: fixed newest-N window, no paging — add paging/filters when Kris needs older rows here
export async function listRecentFunds(db: Db, limit = 100): Promise<FundsListRow[]> {
  const { data, error } = await db.from("tblfundsrcvd")
    .select("fndsid, fndsdate, fndscaseid, fndspayee, fndspmt")
    .order("fndsdate", { ascending: false }).order("fndsid", { ascending: false }).limit(limit);
  if (error) throw new Error(`tblfundsrcvd list: ${error.message}`);
  return data ?? [];
}

/** Row → form values (edit page). Amount shown as 2-decimal text. */
export function rowValues(r: FundsRow): FundsValues {
  const s = (v: string | null) => v ?? "";
  const pmt = String(r.fndspmt);
  return {
    case: r.fndscaseid == null ? "" : String(r.fndscaseid),
    amount: parseMoney(pmt) ?? pmt,
    date: r.fndsdate, payee: s(r.fndspayee), source: s(r.fndssource), type: s(r.fndstype),
    branch: r.fndsbranch, bankaccount: s(r.fndsbankaccount), description: s(r.fndsdesc),
    comment: s(r.fndscomment), cleared: r.fndsclearedbank ? "on" : "", datecleared: s(r.fndsdatecleared),
    clearingnotes: s(r.fndsclearingnotes),
  };
}

export type FundsDeps = {
  session: () => Promise<Session>;
  db: () => Db;
  revalidatePath: (p: string) => void;
  redirect: (url: string) => void;
};

/** The session call is the auth check (staff and admin may record funds); anything unexpected → "failed". */
async function attempt(where: string, deps: FundsDeps, op: () => Promise<void>): Promise<string | null> {
  try {
    await deps.session(); // its /login redirect (NEXT_REDIRECT) must propagate, so only ForbiddenError is caught
  } catch (e) {
    if (e instanceof Error && e.name === "ForbiddenError") return "forbidden";
    throw e;
  }
  try {
    await op();
    return null;
  } catch (e) {
    if (e instanceof FundsError) return e.code;
    console.error(`${where}:`, e); // raw DB text stays in the server log
    return "failed";
  }
}

const reader = (formData: FormData) => (k: string) => (typeof formData.get(k) === "string" ? String(formData.get(k)) : "");
/** `?error=<code>&<every field as typed>` so the form re-renders with the user's input. */
const echo = (code: string, get: (k: string) => string) =>
  new URLSearchParams([["error", code], ...FUNDS_FIELDS.map((k) => [k, get(k)] as [string, string])]).toString();

/** `bill` (/funds/new → /funds/[id] preselect) passes only as a plain positive integer; anything else is dropped. */
export const billParam = (raw: string): string | undefined => (/^[1-9]\d{0,8}$/.test(raw) ? raw : undefined);

/** /funds/new action body. Success → /funds/<id>?saved=1; refusal → /funds/new?error=<code>&<fields>. */
export async function runCreateFunds(formData: FormData, deps: FundsDeps): Promise<void> {
  const get = reader(formData);
  let id = 0;
  const code = await attempt("createFunds", deps, async () => { id = await createFunds(deps.db(), get); });
  deps.revalidatePath("/funds");
  const bill = billParam(get("bill").trim());
  const tail = bill ? `&bill=${bill}` : "";
  deps.redirect(code ? `/funds/new?${echo(code, get)}${tail}` : `/funds/${id}?saved=1${tail}`);
}

/** /funds/[id] edit action body. Success → /funds/<id>?saved=1; refusal → /funds/<id>?error=<code>&<fields>. */
export async function runUpdateFunds(fndsid: number, formData: FormData, deps: FundsDeps): Promise<void> {
  const get = reader(formData);
  const code = await attempt("updateFunds", deps, async () => {
    if (!Number.isSafeInteger(fndsid) || fndsid <= 0) throw new FundsError("notfound");
    await updateFunds(deps.db(), fndsid, get);
  });
  deps.revalidatePath("/funds");
  deps.revalidatePath(`/funds/${fndsid}`);
  deps.redirect(code ? `/funds/${fndsid}?${echo(code, get)}` : `/funds/${fndsid}?saved=1`);
}
