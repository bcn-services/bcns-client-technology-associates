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

/** Validates, checks the case exists (one select on tblcase), then inserts one tblactivity row. */
export async function insertEntry(db: Db, session: Pick<Session, "personId">, input: EntryInput): Promise<void> {
  const personId = session.personId;
  if (personId == null) throw new TimeInputError("unlinked");
  const rawCase = String(input.caseId ?? "").trim();
  if (!/^\d{1,9}$/.test(rawCase)) throw new TimeInputError("case");
  const acthrs = parseHours(String(input.hours ?? ""));
  const actdescription = String(input.description ?? "").trim();
  if (!actdescription) throw new TimeInputError("description");
  const actdate = parseDate(String(input.date ?? ""));
  const actcaseid = Number(rawCase);

  const found = await db.from("tblcase").select("caseid").eq("caseid", actcaseid).maybeSingle();
  if (found.error) throw new Error(`tblcase read: ${found.error.message}`);
  if (!found.data) throw new TimeInputError("case");

  const { error } = await db.from("tblactivity").insert({ actcaseid, actdate, actdescription, acthrs, actwho: personId });
  if (error) throw new Error(`tblactivity insert: ${error.message}`);
}
