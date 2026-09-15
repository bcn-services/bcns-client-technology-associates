/** Description key for matching: lowercase, digits stripped, whitespace collapsed. */
export const normalizeDescription = (s: string): string => s.toLowerCase().replace(/\d/g, "").replace(/\s+/g, " ").trim();

/**
 * Pure: the expense type used most often on past expenses whose normalized description equals this one's; null when
 * none match. Only `allowed` types count (pass the active ids), so a retired type is never suggested. Tie → lower id.
 */
export function suggestType(
  description: string,
  past: { expdscr: string | null; exptype: number | null }[],
  allowed: ReadonlySet<number>,
): number | null {
  const key = normalizeDescription(description);
  if (!key) return null;
  const counts = new Map<number, number>();
  for (const p of past) {
    if (p.exptype == null || !allowed.has(p.exptype) || normalizeDescription(p.expdscr ?? "") !== key) continue;
    counts.set(p.exptype, (counts.get(p.exptype) ?? 0) + 1);
  }
  let best: number | null = null;
  for (const [t, n] of counts) if (best == null || n > counts.get(best)! || (n === counts.get(best)! && t < best)) best = t;
  return best;
}
