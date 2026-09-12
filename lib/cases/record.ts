/**
 * The case record (/cases/[id]), per legacy frmCaseUpdate: field spec, form parsing, the
 * changed-columns diff and casestatlastupdated stamp, live badges, name/address formatting,
 * and the loads/save the page and server action use. DB and clock are injected.
 * There is deliberately no delete here (lane rule), and numunpaidbills / numunapprovedsa
 * are not in FIELDS, so they can never be parsed or written.
 */
import { labelLines, type LabelAttorney, type LabelFirm } from "./search";
import { fetchAll } from "../contacts/contacts";

/** Structural slice of the Supabase client this module uses. */
export interface Db {
  from(table: string): any;
}
export type Row = Record<string, string | number | boolean | null>;
type Kind = "text" | "date" | "int" | "bool";
export type Control =
  | "text" | "textarea" | "date" | "int" | "bool" | "status" | "branch" | "priority" | "waitingfor"
  | "attorney" | "client" | "inquiry" | "pointman" | "eventdesc";
export type Field = { col: string; label: string; kind: Kind; control: Control; required?: boolean };

const fld = (col: string, label: string, kind: Kind, control: Control = kind, required = false): Field => ({ col, label, kind, control, required });

export const FIELDS: Field[] = [
  fld("casetitle", "Title", "text", "text", true),
  fld("casesubject", "Subject", "text"),
  fld("casecaption", "Caption", "text", "textarea"),
  fld("casenotes", "Notes", "text", "textarea"),
  fld("casestartdate", "Start Date", "date", "date", true),
  fld("caseenddate", "End Date", "date"),
  fld("status", "Status", "text", "status", true),
  fld("tabranch", "Branch", "text", "branch", true),
  fld("caseatty", "Attorney", "int", "attorney", true),
  fld("caseclient", "Client", "int", "client", true),
  fld("casestatpriority", "Priority", "text", "priority"),
  fld("casestatsubpriority", "Sub-Priority", "int"),
  fld("casestatwaitingfor", "Waiting For", "text", "waitingfor"),
  fld("casestatdescription", "Description", "text", "textarea"),
  fld("casestatduedate", "Event Date", "date"),
  fld("casestatduedatedescription", "Event Description", "text", "eventdesc"),
  fld("casestatpointman", "Point Man", "text", "pointman"),
  fld("caseinquiry", "Inquiry", "int", "inquiry"),
  fld("otherexperts", "Other Experts", "text"),
  fld("billingalert", "Billing Alert", "bool"),
  fld("billingcc", "Billing CC", "text"),
];
const FIELD = new Map(FIELDS.map((f) => [f.col, f]));
export function field(col: string): Field {
  const f = FIELD.get(col);
  if (!f) throw new Error(`unknown case field ${col}`);
  return f;
}

/** Saving a change to any of these stamps casestatlastupdated with now. */
export const STAMP_COLS = [
  "status", "casestatpriority", "casestatsubpriority", "casestatwaitingfor", "casestatdescription",
  "casestatduedate", "casestatduedatedescription", "casestatpointman",
];
export const POINT_MEN = ["IUO", "KJS", "RMD", "JH", "Oren", "RC", "LLB"];
export const EVENT_SUGGESTIONS = ["Inspection", "Telecom", "Meeting", "IUO Depo", "KJS Depo", "LLB Depo", "Trial"];
export const UNPAID_NOTICES = ["1st", "2nd", "Final", "Partial Payment", "Deadbeat", "Small Claims"];
export const BADGE = { unpaid: "Unpaid Bill", unapproved: "Unapproved SA", feeSchedule: "Warning: No Scanned Fee Schedule on File" };

/** A user-fixable save error. `code` ("required:<col>", "int:<col>", "date:<col>", "notfound") goes in the redirect URL. */
export class CaseInputError extends Error {
  constructor(message: string, readonly code: string) { super(message); }
}

const ERROR_TEXT: Record<string, (label: string) => string> = {
  required: (l) => `${l} is required`,
  int: (l) => `${l} must be a whole number`,
  date: (l) => `${l} must be a date (YYYY-MM-DD)`,
};
/** Fixed on-screen text for an `?error=` code; anything unrecognized gets the generic message, never the raw param. */
export function errorMessage(code: string): string {
  if (code === "notfound") return "This case no longer exists.";
  const [kind = "", col = ""] = code.split(":");
  const f = FIELD.get(col), text = ERROR_TEXT[kind];
  return f && text ? text(f.label) : "Save failed; nothing was changed.";
}

const crlf = (s: string) => s.replace(/\r\n?/g, "\n");
const isDate = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`)) && new Date(`${s}T00:00:00Z`).toISOString().slice(0, 10) === s;

/** The string an input shows for a stored value (and what an untouched form submits back). */
export function formValue(f: Field, row: Row): string {
  const v = row[f.col];
  if (v == null) return "";
  return f.kind === "date" ? String(v).slice(0, 10) : String(v);
}

/**
 * FormData → typed values for only the fields present in the form. "" is null;
 * a checkbox counts only when its `<col>__present` marker was submitted.
 */
export function parseCaseForm(form: FormData): Row {
  const out: Row = {};
  for (const f of FIELDS) {
    if (f.kind === "bool") {
      if (form.has(`${f.col}__present`)) out[f.col] = form.has(f.col);
      continue;
    }
    if (!form.has(f.col)) continue;
    const raw = form.get(f.col);
    const s = typeof raw === "string" ? raw : "";
    if (f.required && s.trim() === "") throw new CaseInputError(`${f.label} is required`, `required:${f.col}`);
    if (s === "") { out[f.col] = null; continue; }
    if (f.kind === "int") {
      if (!/^-?\d{1,9}$/.test(s.trim())) throw new CaseInputError(`${f.label} must be a whole number`, `int:${f.col}`);
      out[f.col] = Number(s.trim());
    } else if (f.kind === "date") {
      if (!isDate(s)) throw new CaseInputError(`${f.label} must be a date (YYYY-MM-DD)`, `date:${f.col}`);
      out[f.col] = s;
    } else out[f.col] = crlf(s);
  }
  return out;
}

/** Controls rendered as `<input type=text>`: browsers strip CR/LF from their values. */
const SINGLE_LINE = new Set<Control>(["text", "eventdesc"]);

/**
 * Comparable form of a value: blanks are null, dates are YYYY-MM-DD, numbers are numbers, CRLF is LF.
 * Single-line inputs compare with CR/LF removed on both sides, so a legacy newline the browser
 * stripped from the input (but not from `__orig`) doesn't count as a change and stays in the DB.
 */
function norm(f: Field, v: unknown): string | number | boolean | null {
  if (f.kind === "bool") return v === true;
  if (v === "" || v == null) return null;
  if (f.kind === "int") return Number(v);
  if (f.kind === "date") return String(v).slice(0, 10);
  const s = crlf(String(v));
  return SINGLE_LINE.has(f.control) ? s.replace(/\n/g, "") || null : s;
}

/**
 * Only allow-listed submitted columns whose original is known and whose normalized value
 * differs from it. A column with no original is never written (fail closed).
 */
export function diffCase(original: Row, submitted: Row): Row {
  const out: Row = {};
  for (const [col, v] of Object.entries(submitted)) {
    const f = FIELD.get(col);
    if (f && col in original && norm(f, original[col]) !== norm(f, v)) out[col] = v;
  }
  return out;
}

/** The value each field had when the form was rendered, from its `<col>__orig` hidden input. */
export function origValue(f: Field, row: Row): string {
  return f.kind === "bool" ? String(row[f.col] === true) : formValue(f, row);
}

/** `<col>__orig` inputs → comparable originals, for allow-listed FIELDS only. */
export function parseOrig(form: FormData): Row {
  const out: Row = {};
  for (const f of FIELDS) {
    const raw = form.get(`${f.col}__orig`);
    if (typeof raw !== "string") continue;
    out[f.col] = f.kind === "bool" ? raw === "true" : raw;
  }
  return out;
}

/** Adds casestatlastupdated = now when any status-tracking column changed. */
export function stamp(changes: Row, now: Date): Row {
  return STAMP_COLS.some((c) => c in changes) ? { ...changes, casestatlastupdated: now.toISOString() } : changes;
}

/**
 * The save the server action runs: diff the submission against the values the form was
 * rendered with (not the row as it is now, so a stale form never reverts another user's
 * change), write only changed columns (plus the stamp). An unchanged form issues no update.
 * Returns what was written.
 */
export async function saveCase(db: Db, id: number, form: FormData, now: Date): Promise<Row> {
  const submitted = parseCaseForm(form);
  const { data: current, error } = await db.from("tblcase").select("caseid").eq("caseid", id).maybeSingle();
  if (error) throw new Error(`tblcase read: ${error.message}`);
  if (!current) throw new CaseInputError(`Case ${id} not found`, "notfound");
  // ponytail: last-writer-wins per column when two users change the same field — add a version check if that bites.
  const changes = diffCase(parseOrig(form), submitted);
  if (Object.keys(changes).length === 0) return changes;
  const write = stamp(changes, now);
  const { error: upErr } = await db.from("tblcase").update(write).eq("caseid", id);
  if (upErr) throw new Error(`tblcase update: ${upErr.message}`);
  return write;
}

/** Live badges from the case row, its bills' notices, and its service auths' statuses. */
export function badges(kase: Row, notices: unknown[], saStatuses: unknown[]): string[] {
  const unpaid = new Set(UNPAID_NOTICES.map((n) => n.toLowerCase()));
  const out: string[] = [];
  if (notices.some((n) => unpaid.has(String(n ?? "").trim().toLowerCase()))) out.push(BADGE.unpaid);
  if (saStatuses.some((s) => !String(s ?? "").toLowerCase().includes("approved"))) out.push(BADGE.unapproved);
  if (kase.numscannedfeeschedule === 0 && Number(kase.caseid) > 1850) out.push(BADGE.feeSchedule);
  return out;
}

const join = (sep: string, ...xs: unknown[]) => xs.map((x) => (x == null ? "" : String(x).trim())).filter(Boolean).join(sep);

/** "Pat Q Example, Jr., Esq." — blank when the row is missing. */
export const attorneyName = (a: Row | null) => (a ? labelLines(a as unknown as LabelAttorney, null)[0] ?? "" : "");
/** Last name first, for the rolodex card and the picker: "Example, Pat Q, Jr." */
export const rolodexName = (a: Row | null) => (a ? join(", ", a.attylastname, join(" ", a.attyfirstname, a.attymiddlename), a.attysuffix) : "");
export const clientName = (c: Row | null) => (c ? join(" ", c.clienttitle, c.clientfirstname, c.clientlastname) : "");
/** Street lines and "City, ST zip"; [] when the firm row is missing. */
export const firmAddress = (f: Row | null) => (f ? labelLines(null, { ...(f as unknown as LabelFirm), frmname: "" }) : []);

export function rolodexLines(atty: Row | null, firm: Row | null): string[] {
  return [
    rolodexName(atty), join("", firm?.frmname), ...firmAddress(firm),
    firm?.frmphone ? `Phone: ${join("", firm.frmphone)}` : "", firm?.frmfax ? `Fax: ${join("", firm.frmfax)}` : "",
  ].filter(Boolean);
}

async function one(db: Db, table: string, col: string, v: unknown): Promise<Row | null> {
  if (v == null) return null;
  const { data, error } = await db.from(table).select("*").eq(col, v).maybeSingle();
  if (error) throw new Error(`${table} read: ${error.message}`);
  return data;
}

async function column(db: Db, table: string, col: string, caseCol: string, id: number): Promise<unknown[]> {
  const { data, error } = await db.from(table).select(col).eq(caseCol, id);
  if (error) throw new Error(`${table} read: ${error.message}`);
  return (data as Row[]).map((r) => r[col]);
}

async function neighbor(db: Db, id: number, dir: "prev" | "next"): Promise<number | null> {
  const q = db.from("tblcase").select("caseid");
  const { data, error } = await (dir === "prev" ? q.lt("caseid", id).order("caseid", { ascending: false }) : q.gt("caseid", id).order("caseid")).limit(1);
  if (error) throw new Error(`tblcase read: ${error.message}`);
  return data[0]?.caseid ?? null;
}

/** The case with its attorney, firm, client (each null when missing), neighbours, and badges. */
export async function loadCaseRecord(db: Db, id: number) {
  const kase = await one(db, "tblcase", "caseid", id);
  if (!kase) return null;
  const [atty, client, notices, statuses, prev, next] = await Promise.all([
    one(db, "tblattorney", "attyid", kase.caseatty),
    one(db, "tblclient", "clientid", kase.caseclient),
    column(db, "tblbills", "billnotice", "billcaseid", id),
    column(db, "tblsrvauth", "srvauthstatus", "srvauthcaseid", id),
    neighbor(db, id, "prev"),
    neighbor(db, id, "next"),
  ]);
  const firm = atty ? await one(db, "tblfirm", "frmid", atty.attyfirmid) : null;
  return { kase, atty, firm, client, prev, next, badges: badges(kase, notices, statuses) };
}

export type Option = { value: string; label: string };
const ci = (a: Option, b: Option) => a.label.toLowerCase().localeCompare(b.label.toLowerCase());

/** Dropdown contents, read live. */
export async function loadCaseOptions(db: Db) {
  // ponytail: every attorney / client / inquiry is loaded per render — fine at thousands; move to a typeahead if it gets slow.
  const [status, branch, priority, waitingfor, attys, clients, inquiries] = await Promise.all([
    fetchAll(db, "tblcasestatus", "casestatus", "casestatus"),
    fetchAll(db, "tblbranches", "branch", "branch"),
    fetchAll(db, "tblcasepriority", "priority", "priority"),
    fetchAll(db, "tblcasewaitingfor", "waitingfor", "waitingfor"),
    fetchAll(db, "tblattorney", "attyid, attyfirstname, attymiddlename, attylastname, attysuffix", "attyid"),
    fetchAll(db, "tblclient", "clientid, clienttitle, clientfirstname, clientlastname", "clientid"),
    fetchAll(db, "tblinquiry", "id, inqdate, inqsubject", "id"),
  ]);
  const list = (rows: Row[], col: string) => rows.map((r) => String(r[col]));
  return {
    status: list(status, "casestatus"),
    branch: list(branch, "branch"),
    priority: list(priority, "priority"),
    waitingfor: list(waitingfor, "waitingfor"),
    pointman: POINT_MEN,
    attorney: attys.map((a) => ({ value: String(a.attyid), label: rolodexName(a) || `#${a.attyid}` })).sort(ci),
    client: clients.map((c) => ({ value: String(c.clientid), label: join(", ", c.clientlastname, c.clientfirstname) || `#${c.clientid}` })).sort(ci),
    // Newest first, as the legacy inquiry combo.
    inquiry: inquiries
      .sort((a, b) => String(b.inqdate ?? "").localeCompare(String(a.inqdate ?? "")) || Number(b.id) - Number(a.id))
      .map((i) => ({ value: String(i.id), label: join(" — ", `#${i.id}`, i.inqdate, i.inqsubject) })),
  };
}
export type CaseOptions = Awaited<ReturnType<typeof loadCaseOptions>>;
