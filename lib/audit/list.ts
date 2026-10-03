/**
 * Admin-only read of audit_log (written solely by the audit_row trigger; nothing here writes).
 * Keyset-paged on the primary key `id` (newest first): the table is ~550k rows, so never offset, never load all.
 */
import { requireSession, type SessionClient } from "@/lib/auth/session";
import type { Db } from "@/lib/time/entries";

export const PAGE_SIZE = 50;

export type AuditFilters = { table?: string; rowid?: string; actor?: string; from?: string; to?: string; before?: number };
export type AuditRow = {
  id: number; tablename: string; rowid: string; op: "INSERT" | "UPDATE" | "DELETE";
  olddata: Record<string, unknown> | null; newdata: Record<string, unknown> | null; actor: string | null; at: string;
};
export type FieldChange = { field: string; from: unknown; to: unknown };

/** `actor=none` filters the rows with no recorded actor (old rows, and writes made outside a user session). */
export const NO_ACTOR = "none";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

type Params = Record<string, string | string[] | undefined>;
const first = (v: string | string[] | undefined) => ((Array.isArray(v) ? v[0] : v) ?? "").trim();
const validDate = (s: string) => DATE_RE.test(s) && new Date(`${s}T00:00:00Z`).toISOString().startsWith(s);

/** Query string → filters. Malformed values are dropped rather than erroring, so a stale link still renders. */
export function parseFilters(p: Params): AuditFilters {
  const f: AuditFilters = {};
  const table = first(p.table), rowid = first(p.rowid), actor = first(p.actor), from = first(p.from), to = first(p.to), before = first(p.before);
  if (table) f.table = table;
  if (rowid) f.rowid = rowid;
  if (actor === NO_ACTOR || UUID_RE.test(actor)) f.actor = actor.toLowerCase();
  if (validDate(from)) f.from = from;
  if (validDate(to)) f.to = to;
  if (/^[1-9]\d{0,14}$/.test(before)) f.before = Number(before);
  return f;
}

/** The day after a YYYY-MM-DD, so an inclusive `to` date becomes an exclusive upper bound. */
const nextDay = (d: string) => new Date(Date.parse(`${d}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);

/**
 * Filters → the PostgREST chain. Dates are UTC midnights (audit_log.at is timestamptz).
 * ponytail: UTC day edges, not the firm's local day — upgrade when Kris needs local-day ranges.
 * Newest-first paging needs no extra index; a rare filter (one rowid) walks the id index backward until it has a page.
 */
export function queryAudit(db: Db, f: AuditFilters, limit = PAGE_SIZE) {
  let q = db.from("audit_log").select("id, tablename, rowid, op, olddata, newdata, actor, at");
  if (f.table) q = q.eq("tablename", f.table);
  if (f.rowid) q = q.eq("rowid", f.rowid);
  if (f.actor === NO_ACTOR) q = q.is("actor", null);
  else if (f.actor) q = q.eq("actor", f.actor);
  if (f.from) q = q.gte("at", `${f.from}T00:00:00Z`);
  if (f.to) q = q.lt("at", `${nextDay(f.to)}T00:00:00Z`);
  if (f.before) q = q.lt("id", f.before);
  return q.order("id", { ascending: false }).limit(limit + 1); // one extra row = "is there an older page"
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** Fields whose value differs between olddata and newdata (a key missing on one side counts as changed), sorted by name. */
export function changedFields(oldData: Record<string, unknown> | null, newData: Record<string, unknown> | null): FieldChange[] {
  const o = oldData ?? {}, n = newData ?? {};
  return [...new Set([...Object.keys(o), ...Object.keys(n)])].sort()
    .filter((k) => !(k in o && k in n && same(o[k], n[k])))
    .map((field) => ({ field, from: o[field] ?? null, to: n[field] ?? null }));
}

export type Actor = { id: string; email: string; initials: string | null };

/** Display name for an actor id. Null → system; an id with no profiles row (deactivated user) → a short id. */
export function actorName(id: string | null, actors: Map<string, Actor>): string {
  if (!id) return "system / unknown";
  const a = actors.get(id);
  if (!a) return `former user (${id.slice(0, 8)})`;
  return a.initials ? `${a.initials} (${a.email})` : a.email;
}

/** All staff (profiles is small), with billing initials, for both the name column and the actor filter. */
export async function loadActors(db: Db): Promise<Map<string, Actor>> {
  const [p, b] = await Promise.all([
    db.from("profiles").select("id, email, personid").order("email"),
    db.from("tblbillingnames").select("personid, initials"),
  ]);
  if (p.error) throw new Error(`profiles: ${p.error.message}`);
  const initials = new Map<number, string>((b.error ? [] : b.data ?? []).map((r: { personid: number; initials: string }) => [r.personid, r.initials]));
  return new Map((p.data ?? []).map((r: { id: string; email: string; personid: number | null }) =>
    [r.id, { id: r.id, email: r.email, initials: r.personid == null ? null : initials.get(r.personid) ?? null }]));
}

export type AuditPage = { rows: AuditRow[]; nextBefore: number | null; actors: Map<string, Actor> };

/**
 * Page entry point. Admin only: requireSession("admin") throws ForbiddenError for staff BEFORE any query runs.
 * `client` is injectable for tests, like the other run* entry points.
 */
export async function runAuditList(deps: { db: Db; params: Params; client?: SessionClient | null }): Promise<AuditPage> {
  await requireSession("admin", deps.client);
  const f = parseFilters(deps.params);
  const [{ data, error }, actors] = await Promise.all([queryAudit(deps.db, f), loadActors(deps.db)]);
  if (error) throw new Error(`audit_log: ${error.message}`);
  const all = (data ?? []) as AuditRow[];
  const rows = all.slice(0, PAGE_SIZE);
  return { rows, nextBefore: all.length > PAGE_SIZE ? rows[PAGE_SIZE - 1]!.id : null, actors };
}
