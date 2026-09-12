/**
 * New case (/cases/new), per legacy frmCaseAdd: the prefilled case number, the three legacy
 * defaults, form parsing, and the insert. Item 8 (inquiry → case) reuses nextCaseId / insertCase.
 * The insert always carries an explicit caseid: the identity default lags behind migrated ids.
 * A taken number is decided by the primary key (23505), never by a pre-check, so two
 * concurrent saves of one number yield one row and one refusal.
 */
import { CaseInputError, FIELDS, errorMessage, parseCaseForm, type Db, type Row } from "./record";
import { todayIso } from "../inquiries/inquiries";

export const DUPLICATE_CASE = "Case number already exists";
export const CREATE_FAILED = "Save failed; the case was not created.";

/** The legacy frmCaseAdd defaults; start date is today in the server's zone. */
export function newCaseDefaults(now: Date): Row {
  return { casetitle: "TBD", casestartdate: todayIso(now), status: "Open" };
}

/** max(caseid) + 1; 1 when there are no cases. */
export async function nextCaseId(db: Db): Promise<number> {
  const { data, error } = await db.from("tblcase").select("caseid").order("caseid", { ascending: false }).limit(1);
  if (error) throw new Error(`tblcase read: ${error.message}`);
  return Number(data?.[0]?.caseid ?? 0) + 1;
}

export type CreateResult = { ok: true; id: number } | { ok: false; error: string };

/** Inserts with the explicit caseid in `fields`. Only a PK/unique violation maps to DUPLICATE_CASE; raw DB text never leaves here. */
export async function insertCase(db: Db, fields: Row & { caseid: number }): Promise<CreateResult> {
  if (!Number.isInteger(fields.caseid) || fields.caseid <= 0) return { ok: false, error: "Case number must be a positive whole number" };
  const { data, error } = await db.from("tblcase").insert(fields).select("caseid").single();
  if (error) {
    if (error.code === "23505") return { ok: false, error: DUPLICATE_CASE };
    console.error(`insertCase ${fields.caseid}:`, error);
    return { ok: false, error: CREATE_FAILED };
  }
  return { ok: true, id: Number(data.caseid) };
}

/** New-case columns the form offers (a subset of the record's FIELDS). */
export const CREATE_COLS = ["casetitle", "casesubject", "casecaption", "casestartdate", "status", "tabranch", "caseatty", "caseclient", "caseinquiry"];

/** FormData → the insert payload, caseid included. Throws CaseInputError (message is user-facing). */
export function parseNewCaseForm(form: FormData): Row & { caseid: number } {
  const raw = String(form.get("caseid") ?? "").trim();
  if (!/^\d{1,9}$/.test(raw) || Number(raw) <= 0) throw new CaseInputError("Case number must be a positive whole number", "int:caseid");
  const fd = new FormData();
  for (const c of CREATE_COLS) fd.set(c, typeof form.get(c) === "string" ? String(form.get(c)) : "");
  const parsed = parseCaseForm(fd);
  for (const f of FIELDS) {
    if (f.required && CREATE_COLS.includes(f.col) && parsed[f.col] == null) throw new CaseInputError(errorMessage(`required:${f.col}`), `required:${f.col}`);
  }
  return { ...parsed, caseid: Number(raw) };
}

/** Parse + insert, for the server action. Never throws on user or DB error. */
export async function createCase(db: Db, form: FormData): Promise<CreateResult> {
  let fields;
  try { fields = parseNewCaseForm(form); } catch (e) {
    if (e instanceof CaseInputError) return { ok: false, error: e.message };
    throw e;
  }
  return insertCase(db, fields);
}

/**
 * A `returnTo` the contact create screens may redirect to: a same-origin relative path
 * that is /cases/new, optionally with a query. Anything else → null (ignored).
 */
export function safeReturnTo(raw: unknown): string | null {
  if (typeof raw !== "string" || raw.length > 2000) return null;
  if (/[\\\u0000-\u001f\u007f]/.test(raw)) return null;
  return /^\/cases\/new(?:\?.*)?$/.test(raw) ? raw : null;
}

/** returnTo with `key=value` set (replacing an earlier one), other query kept. */
export function returnWith(returnTo: string, key: string, value: string | number): string {
  const u = new URL(returnTo, "http://local");
  u.searchParams.set(key, String(value));
  return `${u.pathname}${u.search}`;
}
