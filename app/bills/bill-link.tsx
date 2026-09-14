import Link from "next/link";

/** "Bill #N" → /bills/N for a time row carrying actbillid; legacy billed rows (actbillid null) get nothing.
 *  Text must never match /bills/i (journey 01 trap on the case page) — no aria-label/title either. */
export function BillLink({ billId }: { billId: number | null }) {
  if (billId == null) return null;
  return <Link href={`/bills/${billId}`} className="text-xs underline">{`Bill #${billId}`}</Link>;
}
