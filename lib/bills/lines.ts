/**
 * Bill pricing engine — per-type lines from `modBillingAndServAuth.bas` MakeBillWordDoc. Pure: no DB, no
 * clock, no env; the bill date is an input. Integer money only: hours are thousandths, rates and amounts
 * are cents. Callers convert DB numerics with `thousandths()` (lib/time/week.ts) and `toCents()`.
 *
 * Line shape = one `tblbilllines` row (lineno = index + 1). Two roles, told apart by `rate`:
 *  - detail row (rate null, amount 0): an activity row or an estimate item — date, description, hours.
 *  - total row (rate set): "<h> hrs x $<rate>/hr", its hours, the rate charged, and the whole-dollar amount.
 *  Credits (prior funds) and expenses carry only an amount.
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
  /** The bill's activity rows; hours in thousandths. */
  activity: { date: string; description: string; hours: number; personid: number | null }[];
  /** personid → billingfactor in thousandths (1.000 → 1000). */
  factors: Readonly<Record<number, number>>;
  /** The case's tblfundsrcvd rows; amount in cents. */
  funds: { date: string; type: string | null; amount: number }[];
  /** personid → rate in cents the admin typed; replaces only that person's default. */
  overrides?: Readonly<Record<number, number>>;
};

export type PricedBill = { lines: BillLine[]; hours: number; balance: number; estimated: boolean };

/** Legacy `Int(hours * rate + 0.5)` in whole dollars, returned as cents. Integer math only. */
export const lineAmount = (hoursThousandths: number, rateCents: number): number =>
  floorDiv(safeProduct(hoursThousandths, rateCents) + 50_000, 100_000) * 100;

/** VBA `hours & ""` → "10.5"; `"$" & rate` → "$435" (cents only when not whole). */
const fmtHrs = (t: number) => String(t / 1000);
const fmtRate = (c: number) => (c % 100 === 0 ? String(c / 100) : (c / 100).toFixed(2));

const detail = (kind: LineKind, linedate: string | null, description: string, hours: number): BillLine =>
  ({ kind, linedate, description, personid: null, hours, rate: null, amount: 0 });
const total = (kind: LineKind, personid: number | null, hours: number, rate: number): BillLine => ({
  kind, linedate: null, personid, hours, rate, amount: lineAmount(hours, rate),
  description: `${fmtHrs(hours)} hrs${kind === "estimate" ? " (est.)" : ""} x $${fmtRate(rate)}/hr`,
});
/** One estimate group: its items, then "<sum> hrs (est.) x $rate/hr". */
const estimate = (rate: number, items: [string, number][]): BillLine[] => [
  ...items.map(([d, h]) => detail("estimate", null, d, h)),
  total("estimate", null, items.reduce((s, [, h]) => s + h, 0), rate),
];

const byDate = <T extends { date: string }>(rows: T[]) => [...rows].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

function timesheet(input: PricingInput, standard: number): BillLine[] {
  const credits: BillLine[] = byDate(input.funds).map((f) => ({
    kind: "credit", linedate: f.date, description: f.type ?? "", personid: null, hours: null, rate: null, amount: f.amount,
  }));
  const rows = byDate(input.activity);
  const perPerson = new Map<number | null, number>();
  for (const r of rows) {
    if (!Number.isSafeInteger(r.hours)) throw new RangeError(`hours must be integer thousandths: ${r.hours}`);
    perPerson.set(r.personid, (perPerson.get(r.personid) ?? 0) + r.hours);
  }
  const people = [...perPerson.keys()].sort((a, b) => (a === null ? 1 : b === null ? -1 : a - b));
  const totals = people.map((p) => total("charge", p, perPerson.get(p)!, rateFor(input, p, standard)));
  return [...credits, ...rows.map((r) => detail("charge", r.date, r.description, r.hours)), ...totals];
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
  const { standard, testimony } = defaultRates(input.billDate, input.caseStartDate);
  switch (input.billType) {
    case "blank":
      return [];
    case "retainer":
      return [{ kind: "charge", linedate: input.billDate, description: "Initial Advance", personid: null, hours: null, rate: null, amount: 450_000 }];
    case "timesheet":
      return timesheet(input, standard);
    case "depoprep":
      return estimate(standard, [["Review file, prepare for deposition & telecom(s)/meet with atty.", 8000]]);
    case "depo":
      return estimate(testimony, [["Deposition (via Zoom)", 6000]]);
    case "trial":
      return [
        ...estimate(standard, [["Review file and prep for trial", 6000], ["Telecom w/ atty.", 2000]]),
        ...estimate(testimony, [["Travel & court time", 10_000]]),
        { kind: "expense", linedate: null, description: "Expenses: Travel to court & parking", personid: null, hours: null, rate: null, amount: 10_000 },
      ];
    default:
      throw new RangeError(`unknown bill type: ${input.billType}`);
  }
}

/**
 * Hours total = hours on total rows (rate set); balance = charges + estimates + expenses − credits,
 * never clamped (credits beyond charges → negative). Same function for screen and save (item 3).
 */
export function summarize(lines: BillLine[]): Omit<PricedBill, "lines"> {
  let hours = 0, balance = 0;
  for (const l of lines) {
    if ((l.kind === "charge" || l.kind === "estimate") && l.rate !== null && l.hours !== null) hours += l.hours;
    balance += l.kind === "credit" ? -l.amount : l.amount;
  }
  if (!Number.isSafeInteger(hours) || !Number.isSafeInteger(balance)) throw new RangeError("bill total overflow");
  return { hours, balance, estimated: lines.some((l) => l.kind === "estimate") };
}

export function priceBill(input: PricingInput): PricedBill {
  const lines = billLines(input);
  return { lines, ...summarize(lines) };
}
