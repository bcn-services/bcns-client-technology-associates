/**
 * Service authorizations (legacy frmCaseServAuth + the qryServAuth* lists): status rules,
 * form parsing, the __orig diff, the srvdateapproved stamp, the per-case load/save, and the
 * /cases/service-auths lists and totals. DB and "today" are injected. No delete (lane rule).
 */
import { isDate, type Db, type Row } from "./record";

/** frmCaseServAuth's status value list, in form order. */
export const SA_STATUSES = ["Awaiting Approval", "Approved without advance", "Declined", "Modified", "Modified and Approved", "Approved", "Replaced"];

// Case-insensitive, like Access's `=` in the legacy queries.
const low = (s: unknown) => String(s ?? "").toLowerCase();
const APPROVED = ["approved", "modified and approved"];
const UNAPPROVED = ["awaiting approval", "modified"];
const AWAITING = ["awaiting approval"];
export const isApproved = (s: unknown) => APPROVED.includes(low(s));
export const isUnapproved = (s: unknown) => UNAPPROVED.includes(low(s));
export const isAwaiting = (s: unknown) => AWAITING.includes(low(s));

type Kind = "date" | "hours" | "money" | "status" | "text" | "notes";
export type SaField = { col: string; label: string; kind: Kind; required?: boolean };
export const SA_FIELDS: SaField[] = [
  { col: "srvauthdate", label: "Date", kind: "date", required: true },
  { col: "srvauthhours", label: "Hours", kind: "hours", required: true },
  { col: "srvauthstatus", label: "Status", kind: "status", required: true },
  { col: "srvdateapproved", label: "Date approved", kind: "date" },
  { col: "srvauthfile", label: "File", kind: "text" },
  { col: "srvadvance", label: "Advance", kind: "money" },
  { col: "srvauthnotes", label: "Notes", kind: "notes" },
];
const FIELD = new Map(SA_FIELDS.map((f) => [f.col, f]));

/** numeric(9,3): up to 6 whole digits and 3 decimals. Kept as a string so no float rounding reaches the DB. */
const HOURS = /^(\d{1,6}(\.\d{1,3})?|\.\d{1,3})$/;
/** numeric(12,2). */
const MONEY = /^-?(\d{1,10}(\.\d{1,2})?|\.\d{1,2})$/;

export class SaInputError extends Error {
  constructor(message: string, readonly code: string) { super(message); }
}
const TEXT: Record<string, (l: string) => string> = {
  required: (l) => `${l} is required`,
  date: (l) => `${l} must be a date (YYYY-MM-DD)`,
  hours: () => "Hours must be a number with at most 3 decimals",
  money: (l) => `${l} must be an amount with at most 2 decimals`,
  status: () => `Status must be one of: ${SA_STATUSES.join(", ")}`,
};
/** Fixed text for a `?sa_error=` code; unknown codes get the generic message, never the raw param. */
export function saErrorMessage(code: string): string {
  if (code === "notfound") return "That service authorization no longer exists on this case.";
  const [kind = "", col = ""] = code.split(":");
  const f = FIELD.get(col), t = TEXT[kind];
  return f && t ? t(f.label) : "Service authorization not saved; nothing was changed.";
}

const crlf = (s: string) => s.replace(/\r\n?/g, "\n");

/** What an input shows for a stored value (and what an untouched form submits back). */
export function saValue(f: SaField, row: Row): string {
  const v = row[f.col];
  if (v == null || v === "") return "";
  if (f.kind === "date") return String(v).slice(0, 10);
  if (f.kind === "hours") return fmtHours(v);
  return String(v);
}

/** Thousandths as an integer: exact for any value with ≤3 decimals. */
const milli = (v: unknown) => Math.round(Number(v) * 1000);
export const fmtHours = (v: unknown) => (milli(v) / 1000).toFixed(3);

function norm(f: SaField, v: unknown): string | number | null {
  if (v == null || v === "") return null;
  if (f.kind === "hours") return milli(v);
  if (f.kind === "money") return Math.round(Number(v) * 100);
  if (f.kind === "date") return String(v).slice(0, 10);
  const s = crlf(String(v));
  // File is a single-line input: browsers strip CR/LF from it, so compare without them.
  return f.kind === "text" ? s.replace(/\n/g, "") || null : s;
}

/** FormData → typed values for the SA fields present. "" is null; hours/advance stay strings. */
export function parseSaForm(form: FormData): Row {
  const out: Row = {};
  for (const f of SA_FIELDS) {
    if (!form.has(f.col)) continue;
    const raw = form.get(f.col);
    const s = typeof raw === "string" ? raw.trim() === "" ? "" : raw : "";
    if (s === "") {
      if (f.required) throw new SaInputError(`${f.label} is required`, `required:${f.col}`);
      out[f.col] = null;
      continue;
    }
    if (f.kind === "date" && !isDate(s)) throw new SaInputError(`${f.label} must be a date`, `date:${f.col}`);
    if (f.kind === "hours" && !HOURS.test(s.trim())) throw new SaInputError("bad hours", `hours:${f.col}`);
    if (f.kind === "money" && !MONEY.test(s.trim())) throw new SaInputError("bad amount", `money:${f.col}`);
    out[f.col] = f.kind === "hours" || f.kind === "money" ? s.trim() : f.kind === "notes" || f.kind === "text" ? crlf(s) : s;
  }
  return out;
}

/** `<col>__orig` hidden inputs → originals. */
export function parseSaOrig(form: FormData): Row {
  const out: Row = {};
  for (const f of SA_FIELDS) {
    const raw = form.get(`${f.col}__orig`);
    if (typeof raw === "string") out[f.col] = raw;
  }
  return out;
}

/** Submitted columns whose original is known and differs. No original → never written (fail closed). */
export function diffSa(original: Row, submitted: Row): Row {
  const out: Row = {};
  for (const [col, v] of Object.entries(submitted)) {
    const f = FIELD.get(col);
    if (f && col in original && norm(f, original[col]) !== norm(f, v)) out[col] = v;
  }
  return out;
}

function checkStatus(changes: Row) {
  if ("srvauthstatus" in changes && !SA_STATUSES.some((s) => low(s) === low(changes.srvauthstatus)))
    throw new SaInputError("bad status", "status:srvauthstatus");
}

/**
 * Add (no `srvauthid` in the form) or edit one SA row of case `caseId`. Edits write only the
 * columns that differ from their `__orig`; an untouched save writes nothing.
 * Stamp: a transition from a non-approved status (or a new row) into Approved / Modified and
 * Approved sets srvdateapproved = `today` when it is null in the DB, in `__orig`, and in the
 * submission. A hand-entered date wins. Approved ↔ Modified and Approved is not a transition.
 */
export async function saveServiceAuth(db: Db, caseId: number, form: FormData, today: string): Promise<{ srvauthid: number; written: Row }> {
  const submitted = parseSaForm(form);
  const idRaw = form.get("srvauthid");
  const idStr = typeof idRaw === "string" ? idRaw.trim() : "";
  if (idStr !== "" && !/^\d{1,9}$/.test(idStr)) throw new SaInputError("bad id", "notfound");

  if (idStr === "") {
    for (const f of SA_FIELDS) if (f.required && submitted[f.col] == null) throw new SaInputError(`${f.label} is required`, `required:${f.col}`);
    checkStatus(submitted);
    const { data: kase, error } = await db.from("tblcase").select("caseid").eq("caseid", caseId).maybeSingle();
    if (error) throw new Error(`tblcase read: ${error.message}`);
    if (!kase) throw new SaInputError("case not found", "notfound");
    const row: Row = { ...submitted, srvauthcaseid: caseId };
    if (isApproved(row.srvauthstatus) && row.srvdateapproved == null) row.srvdateapproved = today;
    const ins = await db.from("tblsrvauth").insert(row).select("srvauthid").single();
    if (ins.error) throw new Error(`tblsrvauth insert: ${ins.error.message}`);
    return { srvauthid: ins.data.srvauthid, written: row };
  }

  const id = Number(idStr);
  const { data: cur, error } = await db.from("tblsrvauth").select("srvauthid, srvdateapproved").eq("srvauthid", id).eq("srvauthcaseid", caseId).maybeSingle();
  if (error) throw new Error(`tblsrvauth read: ${error.message}`);
  if (!cur) throw new SaInputError("not found", "notfound");
  const orig = parseSaOrig(form);
  const changes = diffSa(orig, submitted);
  checkStatus(changes);
  if ("srvauthstatus" in changes && isApproved(changes.srvauthstatus) && !isApproved(orig.srvauthstatus)
    && cur.srvdateapproved == null && !orig.srvdateapproved && submitted.srvdateapproved == null)
    changes.srvdateapproved = today;
  if (Object.keys(changes).length === 0) return { srvauthid: id, written: changes };
  // ponytail: last-writer-wins per column, as the case record.
  const up = await db.from("tblsrvauth").update(changes).eq("srvauthid", id).eq("srvauthcaseid", caseId);
  if (up.error) throw new Error(`tblsrvauth update: ${up.error.message}`);
  return { srvauthid: id, written: changes };
}

/** The case's SA rows, newest first (auth date, then id). */
export async function loadServiceAuths(db: Db, caseId: number): Promise<Row[]> {
  const { data, error } = await db.from("tblsrvauth").select("*").eq("srvauthcaseid", caseId)
    .order("srvauthdate", { ascending: false }).order("srvauthid", { ascending: false });
  if (error) throw new Error(`tblsrvauth read: ${error.message}`);
  return data;
}

// ---- lists ----

const PAGE = 1000;
async function pages(db: Db, cols: string, statuses: string[] | null): Promise<Row[]> {
  const out: Row[] = [];
  for (let from = 0; ; from += PAGE) {
    let q = db.from("tblsrvauth").select(cols);
    // ilike with no wildcard = case-insensitive equality (the statuses hold no % or _).
    if (statuses) q = q.or(statuses.map((s) => `srvauthstatus.ilike."${s}"`).join(","));
    const { data, error } = await q.order("srvauthid").range(from, from + PAGE - 1);
    if (error) throw new Error(`tblsrvauth read: ${error.message}`);
    out.push(...data);
    if (data.length < PAGE) return out;
  }
}

/** Rows of `table` whose `col` is in `ids`, keyed by `col`. */
async function byId(db: Db, table: string, cols: string, col: string, ids: unknown[]): Promise<Map<unknown, Row>> {
  const uniq = [...new Set(ids.filter((v) => v != null))];
  const out = new Map<unknown, Row>();
  for (let i = 0; i < uniq.length; i += 200) { // URL length
    const { data, error } = await db.from(table).select(cols).in(col, uniq.slice(i, i + 200));
    if (error) throw new Error(`${table} read: ${error.message}`);
    for (const r of data as Row[]) out.set(r[col], r);
  }
  return out;
}

export const SA_LISTS = {
  unapproved: { title: "Unapproved", note: "Awaiting Approval or Modified, by authorization date", statuses: UNAPPROVED, test: isUnapproved },
  awaiting: { title: "Awaiting approval", note: "Awaiting Approval only, by authorization date", statuses: AWAITING, test: isAwaiting },
  approved: { title: "Recently approved", note: "Approved or Modified and Approved, newest approval first", statuses: APPROVED, test: isApproved },
} as const;
export type SaListKind = keyof typeof SA_LISTS;

export type SaListRow = {
  srvauthid: number; caseid: number; title: string; branch: string; attorney: string; firmPhone: string;
  status: string; hours: string; authDate: string; approvedDate: string;
};

const str = (v: unknown) => (v == null ? "" : String(v).trim());
const byStr = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/**
 * A /cases/service-auths list, per legacy qryServAuthAwaitingApproval / qryServAuthApproval /
 * qryServAuthApproved. Attorney and firm phone go case → attorney → firm; missing links are blank.
 * ponytail: every matching row, joined in JS — page it if a list passes a few thousand rows.
 */
export async function serviceAuthList(db: Db, kind: SaListKind): Promise<SaListRow[]> {
  const spec = SA_LISTS[kind];
  const sas = (await pages(db, "srvauthid, srvauthcaseid, srvauthdate, srvauthhours, srvauthstatus, srvdateapproved", [...spec.statuses]))
    .filter((r) => spec.test(r.srvauthstatus));
  const cases = await byId(db, "tblcase", "caseid, casetitle, tabranch, caseatty", "caseid", sas.map((r) => r.srvauthcaseid));
  const attys = await byId(db, "tblattorney", "attyid, attyfirstname, attylastname, attyfirmid", "attyid", [...cases.values()].map((c) => c.caseatty));
  const firms = await byId(db, "tblfirm", "frmid, frmphone", "frmid", [...attys.values()].map((a) => a.attyfirmid));
  const rows = sas.map((r): SaListRow => {
    const c = cases.get(r.srvauthcaseid);
    const a = c ? attys.get(c.caseatty) : undefined;
    const f = a ? firms.get(a.attyfirmid) : undefined;
    return {
      srvauthid: Number(r.srvauthid), caseid: Number(r.srvauthcaseid), title: str(c?.casetitle), branch: str(c?.tabranch),
      attorney: [str(a?.attyfirstname), str(a?.attylastname)].filter(Boolean).join(" "), firmPhone: str(f?.frmphone),
      status: str(r.srvauthstatus), hours: fmtHours(r.srvauthhours), authDate: str(r.srvauthdate).slice(0, 10), approvedDate: str(r.srvdateapproved).slice(0, 10),
    };
  });
  return kind === "approved"
    // Newest approval first; rows with no approval date last.
    ? rows.sort((x, y) => (!x.approvedDate ? 1 : 0) - (!y.approvedDate ? 1 : 0) || byStr(y.approvedDate, x.approvedDate) || y.srvauthid - x.srvauthid)
    : rows.sort((x, y) => byStr(x.authDate, y.authDate) || x.srvauthid - y.srvauthid);
}

export type SaTotal = { status: string; count: number; hours: string };

/** Count and hours per status (legacy qrySrvAuthTotal); statuses differing only in case are one group. */
export async function serviceAuthTotals(db: Db): Promise<SaTotal[]> {
  const groups = new Map<string, { status: string; count: number; milli: number }>();
  for (const r of await pages(db, "srvauthid, srvauthstatus, srvauthhours", null)) {
    const k = low(r.srvauthstatus);
    const g = groups.get(k) ?? { status: SA_STATUSES.find((s) => low(s) === k) ?? str(r.srvauthstatus), count: 0, milli: 0 };
    g.count++;
    g.milli += milli(r.srvauthhours);
    groups.set(k, g);
  }
  return [...groups.values()].sort((a, b) => byStr(a.status.toLowerCase(), b.status.toLowerCase()))
    .map((g) => ({ status: g.status, count: g.count, hours: (g.milli / 1000).toFixed(3) }));
}
