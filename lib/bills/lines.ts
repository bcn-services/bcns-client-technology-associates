/**
 * Bill pricing engine — per-type lines from `modBillingAndServAuth.bas` MakeBillWordDoc. Pure: no DB, no
 * clock, no env; the bill date is an input. Integer money only: hours are thousandths, rates and amounts
 * are cents. Callers convert DB numerics with `thousandths()` (lib/time/week.ts) and `toCents()`.
 *
 * Line shape = one `tblbilllines` row (lineno = index + 1). Money lives on `amount`, never inferred from `rate`:
 *  - detail row (amount 0, hours set, rate null): an activity row or an estimate item — date, description, hours.
 *  - total row (rate set): "<h> hrs x $<rate>/hr", its hours, the rate charged, and the whole-dollar amount.
 *  - flat row (rate null, hours null, amount set): the retainer's $4,500 charge, a credit, an expense.
 *  A renderer prints a money column for every row with amount ≠ 0; `rate === null` alone does NOT mean detail.
 * Every field is plain data, so an admin-edited description / hours / amount (item 3) round-trips.
 */
import { defaultRates, floorDiv, personRate, safeProduct } from "./rates";

export type LineKind = "charge" | "estimate" | "credit" | "expense";
export type BillLine = {
  kind: LineKind;
  linedate: string | null;
  description: string;
  personid: number | null;
  hours: number | null;
  rate: number | null;
  amount: number;
};

export type PricingInput = {
  billType: string;
  billDate: string;
  caseStartDate: string;
  /** The bill's activity rows; hours in thousandths. `id` (actid) breaks date ties so line order is stable. */
  activity: { date: string; description: string; hours: number; personid: number | null; id?: number }[];
  /** personid → billingfactor in thousandths (1.000 → 1000). */
  factors: Readonly<Record<number, number>>;
  /**
   * ONLY the tblfundsrcvd rows that apply to this bill — pass `creditsForBill(caseFunds, billid)`; every row
   * given is subtracted from the balance. amount in cents; `id` (fndsid) breaks date ties.
   */
  funds: { date: string; type: string | null; amount: number; fndsbillid?: number | null; id?: number }[];
  /** personid → rate in cents the admin typed; replaces only that person's default. */
  overrides?: Readonly<Record<number, number>>;
};

/** Activity time billed as no-person time because its person has no tblbillingnames row (actwho FK is NOT VALID). */
export type PricingWarning = { kind: "unknown-person"; personid: number; hours: number };
/** `warnings` is present only when non-empty. */
export type PricedBill = { lines: BillLine[]; hours: number; balance: number; estimated: boolean; warnings?: PricingWarning[] };

/** An edited line that numeric(12,2) / numeric(8,3) would silently round; `lineno` is 1-based. */
export class BillLineError extends RangeError {
  constructor(readonly lineno: number, readonly field: "amount" | "hours") {
    super(`line ${lineno}: ${field} must be integer ${field === "amount" ? "cents" : "thousandths of an hour"}`);
    this.name = "BillLineError";
  }
}

/**
 * v1 credit rule (logged assumption): a payment counts toward this bill when it is not yet applied to any
 * bill (`fndsbillid` null, e.g. a retainer advance) or is applied to this bill. Payments on other bills drop out.
 */
export const creditsForBill = <T extends { fndsbillid?: number | null }>(funds: T[], billid: number): T[] =>
  funds.filter((f) => f.fndsbillid == null || f.fndsbillid === billid);

/** Legacy `Int(hours * rate + 0.5)` in whole dollars, returned as cents. Integer math only. */
export const lineAmount = (hoursThousandths: number, rateCents: number): number =>
  floorDiv(safeProduct(hoursThousandths, rateCents) + 50_000, 100_000) * 100;

/** VBA `hours & ""` → "10.5"; `"$" & rate` → "$435" (cents only when not whole). */
const fmtHrs = (t: number) => String(t / 1000);
const fmtRate = (c: number) => (c % 100 === 0 ? String(c / 100) : (c / 100).toFixed(2));

const detail = (kind: LineKind, linedate: string | null, description: string, hours: number): BillLine =>
  ({ kind, linedate, description, personid: null, hours, rate: null, amount: 0 });
/** The "<h> hrs [(est.)] x $<rate>/hr" row and its amount — item 3 rebuilds an edited total through this. */
export const totalLine = (
  hoursThousandths: number, rateCents: number,
  { kind = "charge", personid = null }: { kind?: "charge" | "estimate"; personid?: number | null } = {},
): BillLine => ({
  kind, linedate: null, personid, hours: hoursThousandths, rate: rateCents, amount: lineAmount(hoursThousandths, rateCents),
  description: `${fmtHrs(hoursThousandths)} hrs${kind === "estimate" ? " (est.)" : ""} x $${fmtRate(rateCents)}/hr`,
});

/** tblbills.billhours is numeric(8,2): hours thousandths rounded half-up to hundredths (6125 → 6130), for screen and save. */
export const billHours = (hoursThousandths: number): number => floorDiv(safeProduct(hoursThousandths, 1) + 5, 10) * 10;
/** One estimate group: its items, then "<sum> hrs (est.) x $rate/hr". */
const estimate = (rate: number, items: [string, number][]): BillLine[] => [
  ...items.map(([d, h]) => detail("estimate", null, d, h)),
  totalLine(items.reduce((s, [, h]) => s + h, 0), rate, { kind: "estimate" }),
];

/** (date, id) order; rows without an id keep input order on a date tie. */
const byDate = <T extends { date: string; id?: number }>(rows: T[]) =>
  [...rows].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : (a.id ?? 0) - (b.id ?? 0)));

function timesheet(input: PricingInput, standard: number): { lines: BillLine[]; warnings: PricingWarning[] } {
  const credits: BillLine[] = byDate(input.funds).map((f) => ({
    kind: "credit", linedate: f.date, description: f.type ?? "", personid: null, hours: null, rate: null, amount: f.amount,
  }));
  const rows = byDate(input.activity);
  const perPerson = new Map<number | null, number>();
  const unknown = new Map<number, number>();
  for (const r of rows) {
    if (!Number.isSafeInteger(r.hours)) throw new RangeError(`hours must be integer thousandths: ${r.hours}`);
    // A person with no billingfactor row can't be priced or stored (tblbilllines personid FK) → no-person time.
    const orphan = r.personid !== null && !Object.hasOwn(input.factors, r.personid);
    if (orphan) unknown.set(r.personid!, (unknown.get(r.personid!) ?? 0) + r.hours);
    const p = orphan ? null : r.personid;
    perPerson.set(p, (perPerson.get(p) ?? 0) + r.hours);
  }
  const people = [...perPerson.keys()].sort((a, b) => (a === null ? 1 : b === null ? -1 : a - b));
  const totals = people.map((p) => totalLine(perPerson.get(p)!, rateFor(input, p, standard), { personid: p }));
  return {
    lines: [...credits, ...rows.map((r) => detail("charge", r.date, r.description, r.hours)), ...totals],
    warnings: [...unknown].sort(([a], [b]) => a - b).map(([personid, hours]) => ({ kind: "unknown-person", personid, hours })),
  };
}

/** Admin override for that person, else standard × their billingfactor. No person → the standard rate. */
function rateFor(input: PricingInput, personid: number | null, standard: number): number {
  if (personid === null) return standard;
  const o = input.overrides;
  if (o && Object.hasOwn(o, personid)) {
    const r = o[personid]!;
    if (!Number.isSafeInteger(r) || r <= 0) throw new RangeError(`override rate must be positive cents: ${r}`);
    return r;
  }
  if (!Object.hasOwn(input.factors, personid)) throw new RangeError(`no billingfactor for person ${personid}`);
  return personRate(standard, input.factors[personid]!);
}

export function billLines(input: PricingInput): BillLine[] {
  return pricedLines(input).lines;
}

function pricedLines(input: PricingInput): { lines: BillLine[]; warnings?: PricingWarning[] } {
  const { standard, testimony } = defaultRates(input.billDate, input.caseStartDate);
  const only = (lines: BillLine[]) => ({ lines });
  switch (input.billType) {
    case "blank":
      return only([]);
    case "retainer":
      return only([{ kind: "charge", linedate: input.billDate, description: "Initial Advance", personid: null, hours: null, rate: null, amount: 450_000 }]);
    case "timesheet":
      return timesheet(input, standard);
    case "depoprep":
      return only(estimate(standard, [["Review file, prepare for deposition & telecom(s)/meet with atty.", 8000]]));
    case "depo":
      return only(estimate(testimony, [["Deposition (via Zoom)", 6000]]));
    case "trial":
      return only([
        ...estimate(standard, [["Review file and prep for trial", 6000], ["Telecom w/ atty.", 2000]]),
        ...estimate(testimony, [["Travel & court time", 10_000]]),
        { kind: "expense", linedate: null, description: "Expenses: Travel to court & parking", personid: null, hours: null, rate: null, amount: 10_000 },
      ]);
    default:
      throw new RangeError(`unknown bill type: ${input.billType}`);
  }
}

/**
 * Hours total = hours on total rows (rate set); balance = charges + estimates + expenses − credits,
 * never clamped (credits beyond charges → negative). Same function for screen and save (item 3).
 * Throws BillLineError on a line whose amount isn't integer cents or whose hours aren't integer thousandths.
 */
export function summarize(lines: BillLine[]): Omit<PricedBill, "lines" | "warnings"> {
  let hours = 0, balance = 0;
  for (const [i, l] of lines.entries()) {
    if (!Number.isSafeInteger(l.amount)) throw new BillLineError(i + 1, "amount");
    if (l.hours !== null && !Number.isSafeInteger(l.hours)) throw new BillLineError(i + 1, "hours");
    if ((l.kind === "charge" || l.kind === "estimate") && l.rate !== null && l.hours !== null) hours += l.hours;
    balance += l.kind === "credit" ? -l.amount : l.amount;
  }
  if (!Number.isSafeInteger(hours) || !Number.isSafeInteger(balance)) throw new RangeError("bill total overflow");
  return { hours, balance, estimated: lines.some((l) => l.kind === "estimate") };
}

export function priceBill(input: PricingInput): PricedBill {
  const { lines, warnings } = pricedLines(input);
  return { lines, ...summarize(lines), ...(warnings?.length ? { warnings } : {}) };
}
