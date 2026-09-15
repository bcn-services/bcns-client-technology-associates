/** Description key for matching: lowercase, digits stripped, whitespace collapsed. */
export const normalizeDescription = (s: string): string => s.toLowerCase().replace(/\d/g, "").replace(/\s+/g, " ").trim();

export type TypeIndex = Map<string, Map<number, number>>;

/** Pure: normalized description → (allowed type → count). Build once per render; only `allowed` (active) types count. */
export function buildTypeIndex(past: { expdscr: string | null; exptype: number | null }[], allowed: ReadonlySet<number>): TypeIndex {
  const index: TypeIndex = new Map();
  for (const p of past) {
    if (p.exptype == null || !allowed.has(p.exptype)) continue;
    const key = normalizeDescription(p.expdscr ?? "");
    if (!key) continue;
    const counts = index.get(key) ?? new Map<number, number>();
    counts.set(p.exptype, (counts.get(p.exptype) ?? 0) + 1);
    index.set(key, counts);
  }
  return index;
}

/** Pure: the most-used type for this description in the index; null when none match. Tie → lower id. */
export function suggestFromIndex(description: string, index: TypeIndex): number | null {
  const counts = index.get(normalizeDescription(description));
  if (!counts) return null;
  let best: number | null = null;
  for (const [t, n] of counts) if (best == null || n > counts.get(best)! || (n === counts.get(best)! && t < best)) best = t;
  return best;
}

/**
 * Pure: the expense type used most often on past expenses whose normalized description equals this one's; null when
 * none match. Only `allowed` types count (pass the active ids), so a retired type is never suggested. Tie → lower id.
 */
export function suggestType(
  description: string,
  past: { expdscr: string | null; exptype: number | null }[],
  allowed: ReadonlySet<number>,
): number | null {
  return suggestFromIndex(description, buildTypeIndex(past, allowed));
}
