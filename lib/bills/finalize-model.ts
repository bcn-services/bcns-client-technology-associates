/**
 * Finalize form model (billing-output item 3) — pure, shared by the browser (live total) and the server action
 * (save), so the total on screen and the total saved come from the same `finalLines` → `summarize` path.
 * Money is integer cents and hours integer thousandths, parsed from the typed text with string math only.
 *
 * Timesheet: one rate box per total line (`rate.<personid>`, or `rate.none` for time with no person).
 * Other types: estimate groups (`g.<i>.rate`, `g.<i>.n` item count, `g.<i>.<j>.desc` / `.hours`) then flat
 * lines (`f.<k>.desc` / `.amount`: the retainer charge, the trial expense). Kinds and dates come from the base.
 */
import { priceBill, totalLine, type BillLine, type PricingInput } from "./lines";
import { testimonyFor } from "./rates";
import { fmtCents } from "@/lib/expenses/list";

export type Group = { rate: number; items: { description: string; hours: number }[] };
export type Flat = { kind: "charge" | "expense"; linedate: string | null; description: string; amount: number };
export type EstimateModel = { groups: Group[]; flats: Flat[] };
/** What the page rendered from: the pricing input and, for non-timesheet bills, the editable structure. */
export type FinalizeBase = { billType: string; input: PricingInput; model: EstimateModel };

/** Most extra estimate items one group accepts (the page adds them one at a time). */
export const MAX_ITEMS = 50;

export class FinalizeInputError extends Error {
  constructor(readonly code: "rate" | "hours" | "amount" | "description" | "lines") {
    super(code);
    this.name = "FinalizeInputError";
  }
}

const MESSAGES: Record<string, string> = {
  rate: "Each rate must be a dollar amount above zero, like 435.00.",
  hours: "Hours must be a number like 8 or 2.5 (up to 3 decimals).",
  amount: "Amounts must be dollars and cents, like 100.00.",
  description: "Every estimate line with hours needs a description.",
  lines: "Too many estimate lines.",
  range: "A rate, hours or amount is too large to bill.",
  forbidden: "Only admins can finalize bills.",
  stale: "This bill changed meanwhile — reload and try again",
  legacy: "This is a legacy bill: it has no bill type, so there is nothing to finalize.",
  failed: "The bill could not be finalized.",
  notfound: "That bill no longer exists.",
};
export const finalizeErrorMessage = (code: string): string => MESSAGES[code] ?? MESSAGES.failed!;

/** "1,234.5" / "$435" → cents, string math only; null when not dollars with ≤ 2 decimals. */
export function parseCents(raw: string): number | null {
  const m = /^(\d{1,9})(?:\.(\d{1,2}))?$/.exec(raw.trim().replace(/[$,]/g, ""));
  return m ? Number(m[1]) * 100 + Number((m[2] ?? "").padEnd(2, "0")) : null;
}
/** "2.5" → 2500 thousandths; null when not a non-negative number with ≤ 3 decimals. */
export function parseThousandths(raw: string): number | null {
  const m = /^(\d{1,6})(?:\.(\d{1,3}))?$/.exec(raw.trim());
  return m ? Number(m[1]) * 1000 + Number((m[2] ?? "").padEnd(3, "0")) : null;
}
/** Cents → "435.00" (no commas; numeric text for the DB and the form). */
export const centsText = (c: number): string => fmtCents(c).replaceAll(",", "");
/** Thousandths → "2.5" (form text). */
export const hoursText = (t: number): string => String(t / 1000);

/** A timesheet total line's rate-box key. */
export const rateKey = (personid: number | null): string => `rate.${personid ?? "none"}`;

/** Priced or stored non-timesheet lines → groups (detail items closed by their estimate total) + flat lines. */
export function toModel(lines: BillLine[]): EstimateModel {
  const groups: Group[] = [];
  const flats: Flat[] = [];
  let items: Group["items"] = [];
  for (const l of lines) {
    if (l.kind === "estimate" && l.rate === null) items.push({ description: l.description, hours: l.hours ?? 0 });
    else if (l.kind === "estimate") { groups.push({ rate: l.rate!, items }); items = []; }
    else if (l.kind === "charge" || l.kind === "expense") flats.push({ kind: l.kind, linedate: l.linedate, description: l.description, amount: l.amount });
  }
  return { groups, flats };
}

/** Model → lines: each group's items, then its "<sum> hrs (est.) x $rate/hr" through `totalLine`; then the flats. */
export function modelLines(m: EstimateModel): BillLine[] {
  return [
    ...m.groups.flatMap((g) => [
      ...g.items.map((i): BillLine => ({ kind: "estimate", linedate: null, description: i.description, personid: null, hours: i.hours, rate: null, amount: 0 })),
      totalLine(g.items.reduce((s, i) => s + i.hours, 0), g.rate, { kind: "estimate" }),
    ]),
    ...m.flats.map((f): BillLine => ({ ...f, personid: null, hours: null, rate: null })),
  ];
}

/** Timesheet total lines of the base pricing (one per distinct person; `personid` null = no-person time). */
export const timesheetTotals = (input: PricingInput): BillLine[] =>
  priceBill(input).lines.filter((l) => l.kind === "charge" && l.rate !== null);

/** Timesheet lines with the typed rate per total line; the no-person line is rebuilt through `totalLine`. */
function timesheetLines(input: PricingInput, rates: Map<number | null, number>): BillLine[] {
  const overrides: Record<number, number> = {};
  for (const [p, r] of rates) if (p !== null) overrides[p] = r;
  const none = rates.get(null);
  return priceBill({ ...input, overrides }).lines.map((l) =>
    none !== undefined && l.kind === "charge" && l.rate !== null && l.personid === null ? totalLine(l.hours!, none) : l);
}

/**
 * The lines to save, from the base the page rendered and the typed fields (`get` = FormData or form state).
 * Throws FinalizeInputError on any field that isn't whole cents / thousandths. The server only reads the keys
 * its own base defines, so a forged extra field is ignored and a missing one is an error.
 */
export function finalLines(base: FinalizeBase, get: (k: string) => string): BillLine[] {
  const rate = (k: string) => {
    const c = parseCents(get(k));
    if (c === null || c <= 0) throw new FinalizeInputError("rate");
    return c;
  };
  if (base.billType === "timesheet") {
    return timesheetLines(base.input, new Map(timesheetTotals(base.input).map((l) => [l.personid, rate(rateKey(l.personid))])));
  }
  const groups: Group[] = [];
  base.model.groups.forEach((_, i) => {
    const r = rate(`g.${i}.rate`);
    const n = Number(get(`g.${i}.n`));
    if (!Number.isInteger(n) || n < 0 || n > MAX_ITEMS) throw new FinalizeInputError("lines");
    const items: Group["items"] = [];
    for (let j = 0; j < n; j++) {
      const description = get(`g.${i}.${j}.desc`).trim();
      const h = get(`g.${i}.${j}.hours`).trim();
      if (!description && !h) continue; // a blank extra row
      const hours = parseThousandths(h);
      if (hours === null) throw new FinalizeInputError("hours");
      if (!description) throw new FinalizeInputError("description");
      items.push({ description, hours });
    }
    if (items.length) groups.push({ rate: r, items });
  });
  const flats = base.model.flats.map((f, k): Flat => {
    const amount = parseCents(get(`f.${k}.amount`));
    if (amount === null) throw new FinalizeInputError("amount");
    return { ...f, description: get(`f.${k}.desc`).trim() || f.description, amount };
  });
  return modelLines({ groups, flats });
}

/**
 * The form's starting text. Timesheet: each rate box = `prior` rate for that person (a revision's superseded
 * bill's STORED rate) else the default. Other types: the model given (already the superseded bill's stored
 * lines when there are any).
 */
export function initialValues(base: FinalizeBase, prior: Map<number | null, number>): Record<string, string> {
  const v: Record<string, string> = {};
  if (base.billType === "timesheet") {
    for (const l of timesheetTotals(base.input)) v[rateKey(l.personid)] = centsText(prior.get(l.personid) ?? l.rate!);
    return v;
  }
  base.model.groups.forEach((g, i) => {
    v[`g.${i}.rate`] = centsText(g.rate);
    v[`g.${i}.n`] = String(g.items.length);
    g.items.forEach((it, j) => { v[`g.${i}.${j}.desc`] = it.description; v[`g.${i}.${j}.hours`] = hoursText(it.hours); });
  });
  base.model.flats.forEach((f, k) => { v[`f.${k}.desc`] = f.description; v[`f.${k}.amount`] = centsText(f.amount); });
  return v;
}

/** Trial: the testimony box follows a typed standard rate through the legacy map; "" (must be typed) when unmapped. */
export function testimonyText(standard: string): string {
  const c = parseCents(standard);
  const t = c === null ? null : testimonyFor(c);
  return t === null ? "" : centsText(t);
}

/** A billfinalizedat stamp → its date in the firm's zone (yyyy-mm-dd). */
export const finalizedOn = (stamp: string): string =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date(stamp));
