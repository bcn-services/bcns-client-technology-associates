/** Money typed as text: optional "-", up to 10 whole digits, at most 2 decimals; "$" and "," are stripped. */
const MONEY_RE = /^(-?)(\d{1,10})(?:\.(\d{1,2}))?$/;

/**
 * "450" → "450.00", "1,234.5" → "1234.50", "45.001" / "abc" / "0" → null.
 * Pure string work — never parseFloat/Number — so numeric(12,2) receives exactly what was typed.
 */
export function parseMoney(raw: string): string | null {
  const m = MONEY_RE.exec(String(raw ?? "").trim().replace(/[$,]/g, ""));
  if (!m) return null;
  const whole = m[2]!.replace(/^0+(?=\d)/, "");
  const cents = (m[3] ?? "").padEnd(2, "0");
  if (whole === "0" && cents === "00") return null; // a zero payment is not a payment
  return `${m[1]}${whole}.${cents}`;
}
