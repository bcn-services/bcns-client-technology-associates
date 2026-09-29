/**
 * Bill rules: pure functions every billing screen imports. No DB, no clock — `today` is always a parameter.
 * `billnotice` strings use the legacy Access spelling exactly. Dates are yyyy-mm-dd strings; day math goes
 * through Date.UTC on the parsed parts, so the server's TZ never shifts a day.
 */

/** "Open" = still owed. Defined once here (lane global rule). */
export const OPEN_NOTICES: ReadonlySet<string> = new Set(["1st", "2nd", "Final", "Partial Payment", "Deadbeat"]);
/** Statuses a bill can be closed as. */
export const CLOSE_AS_NOTICES: ReadonlySet<string> = new Set(["Cancelled", "Carried Over", "Deadbeat", "Settled"]);
/** Statuses a new bill can start in. */
export const START_NOTICES: ReadonlySet<string> = new Set(["1st", "Credit", "Refund"]);
/** `billtype` check-constraint values (migration 0002); null = legacy bill. */
export const BILL_TYPES: readonly string[] = ["blank", "timesheet", "depoprep", "depo", "trial", "retainer"];
/** Days after the last notice before an open bill is due its next notice. */
export const BILL_DUE_DAYS = 30;

export type BillDates = {
  billnotice: string;
  billdate: string;
  billsecondnoticedate: string | null;
  billfinalnoticedate: string | null;
};

export const isOpen = (notice: string): boolean => OPEN_NOTICES.has(notice);

const NEXT: Readonly<Record<string, string>> = { "1st": "2nd", "2nd": "Final" };
/** 1st → 2nd → Final → null; anything else → null. */
export const nextNotice = (notice: string): string | null => (Object.hasOwn(NEXT, notice) ? NEXT[notice]! : null);

/**
 * `Bill<caseid> <last name> <yyyy mm dd>-<n>`, e.g. `Bill123 Example 2026 08 14-0`. As the VBA's Replace calls on the
 * whole base name: "-" and "_" become spaces, "/" is dropped; then the `-<n>` suffix is appended (n from 0).
 * Unlike the VBA, "'" is KEPT: tests/billing (guard h) pins "O'Neil"; the PDF's storage key drops it (invoiceKey).
 */
export const billFileName = (caseId: number, attyLastName: string, billdate: string, n: number): string =>
  `${`Bill${caseId} ${attyLastName} ${billdate.slice(0, 10).replaceAll("-", " ")}`.replace(/[-_]/g, " ").replaceAll("/", "")}-${n}`;

export const lastNoticeDate = (bill: BillDates): string =>
  bill.billfinalnoticedate ?? bill.billsecondnoticedate ?? bill.billdate;

/** Epoch day number of a yyyy-mm-dd string, TZ-independent. */
const dayNumber = (date: string): number => {
  const [y, m, d] = date.slice(0, 10).split("-").map(Number) as [number, number, number];
  return Date.UTC(y, m - 1, d) / 86_400_000;
};

export const daysSinceNotice = (bill: BillDates, today: string): number => dayNumber(today) - dayNumber(lastNoticeDate(bill));

export const isDue = (bill: BillDates, today: string): boolean =>
  isOpen(bill.billnotice) && daysSinceNotice(bill, today) >= BILL_DUE_DAYS;

/**
 * Finalize may write this bill: typed (legacy bills get nothing new), not yet finalized, not revised (a superseded bill
 * is finalized through its revision), and not closed (Cancelled / Carried Over / Settled are never billed again; Paid and Deadbeat can still be finalized).
 * The one rule behind the Finalize button, the Finalize page and the save.
 */
const NEVER_BILLED_AGAIN: ReadonlySet<string> = new Set(["Cancelled", "Carried Over", "Settled"]);
export const canFinalizeBill = (
  b: { billtype: string | null; billfinalizedat?: string | null; billnotice: string }, revised: boolean,
): boolean => b.billtype != null && !b.billfinalizedat && !revised && !NEVER_BILLED_AGAIN.has(b.billnotice);
