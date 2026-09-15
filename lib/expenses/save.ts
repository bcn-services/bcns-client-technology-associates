// Expense entry and edit (tblexpenses). Pure parsing first, then existence checks, then one write.
// Never deletes; an edit never touches expid (the audit_log trigger records old/new).
import type { Db } from "@/lib/time/entries";
import type { Session } from "@/lib/auth/session";

export class ExpenseInputError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = "ExpenseInputError";
  }
}

const MESSAGES: Record<string, string> = {
  date: "Date must be a valid yyyy-mm-dd date.",
  dscr: "Description is required.",
  checknum: "Check number is required and must be a whole number (0 for no check).",
  type: "Pick an active expense type.",
  amount: "Amount must be a dollar amount with at most 2 decimals.",
  case: "No case with that number.",
  bill: "No bill with that number.",
  init: "Pick initials from the list.",
  datecleared: "Date cleared must be a valid yyyy-mm-dd date.",
  scanned: "Scanned check number must be a whole number.",
  notcounted: "Not-counted-in-profit must be a dollar amount with at most 2 decimals.",
  notfound: "That expense no longer exists.",
};
export const expenseErrorMessage = (code: string) => MESSAGES[code] ?? "Save failed; nothing was changed.";

/** Form field names, in the order they are echoed back on error. */
export const EXPENSE_FIELDS = [
  "date", "dscr", "checknum", "type", "branch", "amount", "reason", "init", "case", "bill",
  "cleared", "datecleared", "bankaccount", "clearingnotes", "scanned", "notcounted",
] as const;
export type ExpenseForm = Record<(typeof EXPENSE_FIELDS)[number], string>;

/** "45" / "45.5" / "-3.25" → "45.00" / "45.50" / "-3.25"; decimal string, never float math. Fits numeric(12,2). */
export function parseMoney(raw: string, code: string): string {
  const m = /^(-?)(\d{1,10})(?:\.(\d{0,2}))?$/.exec(raw.trim().replace(/[$,]/g, ""));
  if (!m) throw new ExpenseInputError(code);
  return `${m[1]}${m[2]!.replace(/^0+(?=\d)/, "")}.${(m[3] ?? "").padEnd(2, "0")}`;
}

function parseDate(raw: string, code: string): string {
  const s = raw.trim();
  const d = /^\d{4}-\d{2}-\d{2}$/.test(s) ? new Date(`${s}T00:00:00Z`) : null;
  if (!d || Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== s) throw new ExpenseInputError(code);
  return s;
}

/** Blank → null; else a positive-or-zero integer that fits int4, or the code. */
function parseInt4(raw: string, code: string, required = false): number | null {
  const s = raw.trim();
  if (!s) {
    if (required) throw new ExpenseInputError(code);
    return null;
  }
  if (!/^\d{1,9}$/.test(s)) throw new ExpenseInputError(code);
  return Number(s);
}
const orNull = (s: string) => s.trim() || null;

/** Pure: form strings → tblexpenses payload (no expid, ever). */
export function parseExpense(f: ExpenseForm) {
  const dscr = f.dscr.trim();
  if (!dscr) throw new ExpenseInputError("dscr");
  const cleared = f.cleared === "on" || f.cleared === "true";
  return {
    expdate: parseDate(f.date, "date"),
    expdscr: dscr,
    expchecknum: parseInt4(f.checknum, "checknum", true) as number,
    exptype: parseInt4(f.type, "type"),
    expbranch: f.branch.trim() || "Stratford",
    expamount: parseMoney(f.amount, "amount"),
    expreason: orNull(f.reason),
    expinit: parseInt4(f.init, "init"),
    expcaseid: parseInt4(f.case, "case"),
    expbillid: parseInt4(f.bill, "bill"),
    expclearedbank: cleared,
    expdatecleared: f.datecleared.trim() ? parseDate(f.datecleared, "datecleared") : null,
    expbankaccount: orNull(f.bankaccount),
    expclearingnotes: orNull(f.clearingnotes),
    exp_scanned_check_number: parseInt4(f.scanned, "scanned"),
    exp_notcountedinprofit: f.notcounted.trim() ? parseMoney(f.notcounted, "notcounted") : null,
  };
}
export type ExpensePayload = ReturnType<typeof parseExpense>;

async function mustExist(db: Db, table: string, col: string, id: number, code: string, active = false): Promise<void> {
  let q = db.from(table).select(col).eq(col, id);
  if (active) q = q.eq("active", true);
  const { data, error } = await q.maybeSingle();
  if (error) throw new Error(`${table} read: ${error.message}`);
  if (!data) throw new ExpenseInputError(code);
}

/** Case / bill must exist and a type must be active — all checked before any write, so no dangling FK is ever sent.
 *  `keepType`: on edit, the row's current type may stay even if since retired. */
async function checkRefs(db: Db, p: ExpensePayload, keepType: number | null): Promise<void> {
  if (p.expcaseid != null) await mustExist(db, "tblcase", "caseid", p.expcaseid, "case");
  if (p.expbillid != null) await mustExist(db, "tblbills", "billid", p.expbillid, "bill");
  if (p.exptype != null && p.exptype !== keepType) await mustExist(db, "tblexptype", "exptypeid", p.exptype, "type", true);
}

export async function insertExpense(db: Db, f: ExpenseForm): Promise<number> {
  const p = parseExpense(f);
  await checkRefs(db, p, null);
  const { data, error } = await db.from("tblexpenses").insert(p).select("expid").single();
  if (error) throw new Error(`tblexpenses insert: ${error.message}`);
  return data.expid;
}

/** Updates every column but expid, filtered by expid; 0 rows → notfound. */
export async function updateExpense(db: Db, expid: number, f: ExpenseForm): Promise<void> {
  const p = parseExpense(f);
  const cur = await getExpense(db, expid); // server-side current type, never a form field
  if (!cur) throw new ExpenseInputError("notfound");
  await checkRefs(db, p, cur.exptype);
  const { data, error } = await db.from("tblexpenses").update(p).eq("expid", expid).select("expid");
  if (error) throw new Error(`tblexpenses update: ${error.message}`);
  if (!data?.length) throw new ExpenseInputError("notfound");
}

export type ExpenseRow = { expid: number; exptype: number | null } & Record<string, unknown>;
export async function getExpense(db: Db, expid: number): Promise<ExpenseRow | null> {
  const { data, error } = await db.from("tblexpenses").select("*").eq("expid", expid).maybeSingle();
  if (error) throw new Error(`tblexpenses read: ${error.message}`);
  return data ?? null;
}

/** Row → form strings (edit page initial values). */
export function formOf(r: Record<string, unknown>): ExpenseForm {
  const s = (v: unknown) => (v == null ? "" : String(v));
  const m = (v: unknown) => (v == null ? "" : parseMoney(String(v), "amount"));
  return {
    date: s(r.expdate), dscr: s(r.expdscr), checknum: s(r.expchecknum), type: s(r.exptype), branch: s(r.expbranch),
    amount: m(r.expamount), reason: s(r.expreason), init: s(r.expinit), case: s(r.expcaseid), bill: s(r.expbillid),
    cleared: r.expclearedbank ? "on" : "", datecleared: s(r.expdatecleared), bankaccount: s(r.expbankaccount),
    clearingnotes: s(r.expclearingnotes), scanned: s(r.exp_scanned_check_number), notcounted: m(r.exp_notcountedinprofit),
  };
}

export const readForm = (formData: FormData): ExpenseForm =>
  Object.fromEntries(EXPENSE_FIELDS.map((k) => [k, typeof formData.get(k) === "string" ? String(formData.get(k)) : ""])) as ExpenseForm;

export type ExpenseDeps = {
  session: () => Promise<Session>;
  db: () => Db;
  revalidatePath: (p: string) => void;
  redirect: (url: string) => void;
};

/** Action body for new (id null) and edit. Staff and admin may both save; the session check runs first. */
export async function runSaveExpense(id: number | null, formData: FormData, deps: ExpenseDeps): Promise<void> {
  await deps.session(); // redirects to /login without a session
  const f = readForm(formData);
  const base = id == null ? "/expenses/new" : `/expenses/${id}`;
  let code: string | null = null;
  let saved = id;
  try {
    if (id == null) saved = await insertExpense(deps.db(), f);
    else {
      if (!Number.isSafeInteger(id) || id <= 0) throw new ExpenseInputError("notfound");
      await updateExpense(deps.db(), id, f);
    }
  } catch (e) {
    if (e instanceof ExpenseInputError) code = e.code;
    else {
      console.error("saveExpense:", e); // raw DB text stays in the server log
      code = "failed";
    }
  }
  deps.revalidatePath(base);
  if (!code) {
    deps.revalidatePath(`/expenses/${saved}`);
    deps.redirect(`/expenses/${saved}?saved=1`);
    return;
  }
  deps.redirect(`${base}?${new URLSearchParams({ error: code, ...f })}`);
}
