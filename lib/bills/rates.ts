/**
 * Default bill rates — the ONE place they live (lane global rule). Legacy 2026 values from
 * `modBillingAndServAuth.bas` TwoYearRateUpdate; guesses until Kris sends the rate card.
 * Money is integer cents; billing factors are integer thousandths (numeric(8,3)). Pure: no DB, no clock.
 */

export const STANDARD_RATE = 43_500;
export const TESTIMONY_RATE = 49_000;
/** Once the bill date is more than 2 years after `casestartdate`. */
export const LATE_STANDARD_RATE = 47_500;
export const LATE_TESTIMONY_RATE = 53_500;

/** Legacy testimony map: standard → testimony, for a standard rate an admin types. 475→535 is the VBA's 2-year pair. */
const TESTIMONY_FOR: Readonly<Record<number, number>> = {
  47_500: 53_500, 43_500: 49_000, 41_500: 47_000, 40_000: 45_000, 37_500: 42_500, 35_000: 40_000,
};
/** Testimony rate for a standard rate, or null when the legacy map has no pair for it. */
export const testimonyFor = (standardCents: number): number | null =>
  Object.hasOwn(TESTIMONY_FOR, standardCents) ? TESTIMONY_FOR[standardCents]! : null;

/**
 * VBA `DateAdd("yyyy", n, d)` on a yyyy-mm-dd string: same month and day n years on; Feb 29 in a
 * non-leap target year becomes Feb 28.
 */
export function addYears(date: string, n: number): string {
  const [y, m, d] = date.slice(0, 10).split("-").map(Number) as [number, number, number];
  const ty = y + n;
  const leap = (ty % 4 === 0 && ty % 100 !== 0) || ty % 400 === 0;
  const day = m === 2 && d === 29 && !leap ? 28 : d;
  return `${String(ty).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** Legacy `BillDate > DateAdd("yyyy", 2, StartDate)`: compares the BILL date, never today. Exactly 2 years is not late. */
export const isLate = (billDate: string, caseStartDate: string): boolean =>
  billDate.slice(0, 10) > addYears(caseStartDate, 2);

export const defaultRates = (billDate: string, caseStartDate: string): { standard: number; testimony: number } =>
  isLate(billDate, caseStartDate)
    ? { standard: LATE_STANDARD_RATE, testimony: LATE_TESTIMONY_RATE }
    : { standard: STANDARD_RATE, testimony: TESTIMONY_RATE };

/** floor(a / b) for safe integers, exact (no float division). b > 0. */
export const floorDiv = (a: number, b: number): number => (a - (((a % b) + b) % b)) / b;

export function safeProduct(a: number, b: number): number {
  if (!Number.isSafeInteger(a) || !Number.isSafeInteger(b)) throw new RangeError(`not integers: ${a}, ${b}`);
  const p = a * b;
  if (!Number.isSafeInteger(p)) throw new RangeError(`money overflow: ${a} × ${b}`);
  return p;
}

/**
 * A person's default rate = standard × billingfactor, rounded half-up to whole cents BEFORE any line
 * math, so a stored numeric(10,2) rate × hours always reproduces the screen total. 43500 × 0.333 → 14486.
 */
export function personRate(standardCents: number, factorThousandths: number): number {
  if (factorThousandths < 0) throw new RangeError(`negative billing factor: ${factorThousandths}`);
  return floorDiv(safeProduct(standardCents, factorThousandths) + 500, 1000);
}
