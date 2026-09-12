/**
 * Time entry insert (/time). `actwho` always comes from the session, never from input.
 * Hours are sent to `acthrs` (numeric(9,3)) as the typed string, so nothing rounds them.
 * Never writes `actbilled` / `actbillid` (the column defaults leave a new row unbilled).
 */
import type { Session } from "../auth/session";

/** Structural slice of the Supabase client, so tests can inject a fake. */
export type Db = { from(table: string): any };

export class TimeInputError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = "TimeInputError";
  }
}

export const NOT_LINKED = "Your login isn't linked to a person — an admin can set it on /users";

const MESSAGES: Record<string, string> = {
  unlinked: NOT_LINKED,
  case: "No case with that number.",
  hours: "Hours must be more than 0 and at most 24, with up to 3 decimals.",
  description: "Description is required.",
  date: "Date must be a valid date.",
  locked: "This entry can't be changed",
};

/** Fixed on-screen text for an error code; unknown codes get a generic message. */
export function errorMessage(code: string): string {
  return MESSAGES[code] ?? "Save failed; the entry was not added.";
}

export type EntryInput = { caseId: string; date: string; hours: string; description: string };

/** "1.5" → "1.5"; throws unless 0 < h ≤ 24 with at most 3 decimals. Returns the string unchanged. */
export function parseHours(raw: string): string {
  const s = raw.trim();
  if (!/^(\d{1,2}(\.\d{0,3})?|\.\d{1,3})$/.test(s)) throw new TimeInputError("hours");
  const n = Number(s);
  if (!(n > 0 && n <= 24)) throw new TimeInputError("hours");
  return s;
}

/** A real YYYY-MM-DD calendar date, checked in UTC (no local-time arithmetic). */
function parseDate(raw: string): string {
  const s = raw.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) throw new TimeInputError("date");
  const d = new Date(`${s}T00:00:00Z`);
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== s) throw new TimeInputError("date");
  return s;
}

/** Shape checks shared by insert and update (no DB call). */
function parseEntry(input: EntryInput) {
  const rawCase = String(input.caseId ?? "").trim();
  if (!/^\d{1,9}$/.test(rawCase)) throw new TimeInputError("case");
  const acthrs = parseHours(String(input.hours ?? ""));
  const actdescription = String(input.description ?? "").trim();
  if (!actdescription) throw new TimeInputError("description");
  const actdate = parseDate(String(input.date ?? ""));
  return { actcaseid: Number(rawCase), actdate, acthrs, actdescription };
}

async function requireCase(db: Db, actcaseid: number): Promise<void> {
  const found = await db.from("tblcase").select("caseid").eq("caseid", actcaseid).maybeSingle();
  if (found.error) throw new Error(`tblcase read: ${found.error.message}`);
  if (!found.data) throw new TimeInputError("case");
}

/** Validates, checks the case exists (one select on tblcase), then inserts one tblactivity row. */
export async function insertEntry(db: Db, session: Pick<Session, "personId">, input: EntryInput): Promise<void> {
  const personId = session.personId;
  if (personId == null) throw new TimeInputError("unlinked");
  const row = parseEntry(input);
  await requireCase(db, row.actcaseid);
  const { error } = await db.from("tblactivity").insert({ ...row, actwho: personId });
  if (error) throw new Error(`tblactivity insert: ${error.message}`);
}

export type EntryRow = {
  actid: number; actcaseid: number; actdate: string; actdescription: string;
  acthrs: number | string; actwho: number | null; actbilled: boolean; actbillid: number | null;
};
type Actor = Pick<Session, "personId" | "role">;

export const isEditable = (r: Pick<EntryRow, "actbilled" | "actbillid">) => r.actbilled === false && r.actbillid == null;

/**
 * Filters every edit/delete statement carries: the row, still unbilled, and (staff) their own.
 * These ARE the refusal — a prior read is never trusted.
 */
function editableOnly(q: any, actid: number, s: Actor): any {
  q = q.eq("actid", actid).eq("actbilled", false).is("actbillid", null);
  return s.role === "admin" ? q : q.eq("actwho", s.personId);
}

/** /time/[id] read: staff see only their own rows (another person's → null = "Not found"). */
export async function loadEntry(db: Db, s: Actor, actid: number): Promise<EntryRow | null> {
  let q = db.from("tblactivity").select("actid, actcaseid, actdate, actdescription, acthrs, actwho, actbilled, actbillid").eq("actid", actid);
  if (s.role !== "admin") q = q.eq("actwho", s.personId);
  const { data, error } = await q.maybeSingle();
  if (error) throw new Error(`tblactivity read: ${error.message}`);
  return data ?? null;
}

/**
 * Edit one unbilled row. `orig` holds the values the form was rendered with (hidden `__orig`
 * inputs, as lib/cases/record.ts); only columns that differ are written, from a fixed whitelist —
 * never actwho, actbilled or actbillid. Returns the row's date (for the week redirect).
 * Zero rows matched by the filtered write → "locked", nothing written.
 */
export async function updateEntry(db: Db, s: Actor, actid: number, input: EntryInput & { orig?: Partial<EntryInput> }): Promise<string> {
  if (s.personId == null) throw new TimeInputError("unlinked");
  const next = parseEntry(input);
  const o = input.orig ?? {};
  const was: Record<string, string | undefined> = {
    actcaseid: o.caseId?.trim(), actdate: o.date?.trim(), acthrs: o.hours?.trim(), actdescription: o.description?.trim(),
  };
  const payload: Record<string, string | number> = {};
  for (const [k, v] of Object.entries(next)) if (was[k] !== String(v)) payload[k] = v;
  if ("actcaseid" in payload) await requireCase(db, next.actcaseid);

  // Nothing changed: no write; success only if the row is still editable by this person.
  const { data, error } = Object.keys(payload).length
    ? await editableOnly(db.from("tblactivity").update(payload), actid, s).select("actid, actdate")
    : await editableOnly(db.from("tblactivity").select("actid, actdate"), actid, s);
  if (error) throw new Error(`tblactivity update: ${error.message}`);
  if (!data?.length) throw new TimeInputError("locked");
  return data[0].actdate;
}

/** Delete one unbilled row (own, or any if admin). Returns the deleted row's date. */
export async function deleteEntry(db: Db, s: Actor, actid: number): Promise<string> {
  if (s.personId == null) throw new TimeInputError("unlinked");
  const { data, error } = await editableOnly(db.from("tblactivity").delete(), actid, s).select("actid, actdate");
  if (error) throw new Error(`tblactivity delete: ${error.message}`);
  if (!data?.length) throw new TimeInputError("locked");
  return data[0].actdate;
}
