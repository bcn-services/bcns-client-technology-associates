/**
 * Week view (/time): Monday–Sunday weeks in America/New_York, computed on YYYY-MM-DD strings only.
 * Day math uses Date.UTC + getUTC* on the date string, so the server's TZ never shifts a day.
 */
import type { Session } from "../auth/session";
import { firmToday } from "../cases/presets";
import type { Db } from "./entries";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const utcDay = (date: string, n = 0) => {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d + n));
};

/** Epoch-day arithmetic on a date string: addDays("2026-01-01", -1) === "2025-12-31". */
export function addDays(date: string, n: number): string {
  return utcDay(date, n).toISOString().slice(0, 10);
}

/** True for a real calendar date string (2026-02-30 is false). */
export function isDate(s: string | undefined | null): s is string {
  return !!s && DATE_RE.test(s) && addDays(s, 0) === s;
}

/** Monday and Sunday of the week containing `anchor` (any day of it); invalid/absent anchor → this firm-local week. */
export function weekBounds(anchor?: string | null): { monday: string; sunday: string } {
  const day = isDate(anchor) ? anchor : firmToday(new Date());
  const dow = utcDay(day).getUTCDay(); // 0 = Sunday
  const monday = addDays(day, -((dow + 6) % 7));
  return { monday, sunday: addDays(monday, 6) };
}

export type WeekRow = {
  actid: number;
  actcaseid: number;
  actdate: string;
  actdescription: string;
  acthrs: number | string;
  actbilled: boolean;
  actbillid: number | null;
  tblcase: { caseid: number; casetitle: string } | null;
};

/** One person's tblactivity rows for Monday..Sunday (inclusive), with case # and title. */
export async function listWeek(db: Db, personId: number, monday: string): Promise<WeekRow[]> {
  const { data, error } = await db
    .from("tblactivity")
    .select("actid, actcaseid, actdate, actdescription, acthrs, actbilled, actbillid, tblcase(caseid, casetitle)")
    .eq("actwho", personId)
    .gte("actdate", monday)
    .lte("actdate", addDays(monday, 6))
    .order("actdate", { ascending: true })
    .order("actid", { ascending: true });
  if (error) throw new Error(`tblactivity week read: ${error.message}`);
  return (data ?? []) as WeekRow[];
}

/** Hours → integer thousandths, so sums never drift (numeric(9,3) has exactly 3 decimals). */
export const thousandths = (h: number | string) => Math.round(Number(h) * 1000);
/** Integer thousandths → "2.125". */
export const fmtHours = (t: number) => (t / 1000).toFixed(3);

export const isBilled = (r: { actbilled: boolean; actbillid: number | null }) => r.actbilled || r.actbillid != null;

export type DayGroup = { date: string; rows: WeekRow[]; total: string };

/** Rows (already date-ordered) → one group per day with a subtotal, plus the week total. */
export function groupByDay(rows: WeekRow[]): { days: DayGroup[]; total: string } {
  const map = new Map<string, { rows: WeekRow[]; t: number }>();
  let all = 0;
  for (const r of rows) {
    const g = map.get(r.actdate) ?? { rows: [], t: 0 };
    g.rows.push(r);
    g.t += thousandths(r.acthrs);
    all += thousandths(r.acthrs);
    map.set(r.actdate, g);
  }
  return {
    days: [...map].map(([date, g]) => ({ date, rows: g.rows, total: fmtHours(g.t) })),
    total: fmtHours(all),
  };
}

/** Whose week to show: admin may pick any person via ?who=; staff always get their own personId. */
export function resolveWho(session: Pick<Session, "role" | "personId">, whoParam?: string | null): number | null {
  if (session.role === "admin" && whoParam && /^\d{1,9}$/.test(whoParam)) return Number(whoParam);
  return session.personId;
}
