/**
 * Clearing view by bank account (replaces Access ClearedExpensesAndIncome): list one account's uncleared expenses and
 * funds, and mark selected rows cleared. Each table gets ONE guarded update whose WHERE carries the account, the
 * submitted id set and "not already cleared" — a row on another account is never touched, whatever ids are submitted.
 * Two tables, no transaction: the result reports each table separately so a partial outcome is visible.
 */
import type { Db } from "../time/entries";
import type { Session } from "../auth/session";

export class ClearingInputError extends Error {
  constructor(public code: string) { super(code); }
}
export const MAX_SELECTED = 200;
export const LIST_LIMIT = 500;
const MESSAGES: Record<string, string> = {
  account: "Pick a bank account.",
  date: "Enter a real cleared date (YYYY-MM-DD).",
  none: "Select at least one row to clear.",
  toomany: `Select at most ${MAX_SELECTED} rows at a time.`,
  failed: "Clearing failed — nothing was changed.",
};
export const clearingErrorMessage = (code: string): string => MESSAGES[code] ?? "Clearing failed.";

export type UnclearedRow = { kind: "Expense" | "Funds"; id: number; date: string; description: string; amount: number | string };

/** Distinct account names across both tables. One limit-1 query per account found (accounts are few). */
export async function listAccounts(db: Db): Promise<string[]> {
  const out = new Set<string>();
  for (const [table, col] of [["tblexpenses", "expbankaccount"], ["tblfundsrcvd", "fndsbankaccount"]] as const) {
    for (let i = 0; i < 100; i++) { // ponytail: stops at 100 accounts per table — plenty for one firm.
      let q = db.from(table).select(col).not(col, "is", null);
      const seen = [...out];
      if (seen.length) q = q.not(col, "in", `(${seen.map((s) => `"${s.replace(/["\\]/g, "\\$&")}"`).join(",")})`);
      const { data, error } = await q.limit(1);
      if (error) throw new Error(`${table} accounts read: ${error.message}`);
      const v = data?.[0]?.[col];
      if (v == null || out.has(v)) break;
      out.add(v);
    }
  }
  return [...out].sort();
}

/** Uncleared (cleared flag not true) expenses and funds on exactly this account, by date. */
export async function listUncleared(db: Db, account: string): Promise<UnclearedRow[]> {
  const [e, f] = await Promise.all([
    db.from("tblexpenses").select("expid, expdate, expdscr, expamount")
      .eq("expbankaccount", account).not("expclearedbank", "is", true).order("expdate").limit(LIST_LIMIT),
    db.from("tblfundsrcvd").select("fndsid, fndsdate, fndspayee, fndsdesc, fndspmt")
      .eq("fndsbankaccount", account).not("fndsclearedbank", "is", true).order("fndsdate").limit(LIST_LIMIT),
  ]);
  if (e.error) throw new Error(`tblexpenses read: ${e.error.message}`);
  if (f.error) throw new Error(`tblfundsrcvd read: ${f.error.message}`);
  const rows: UnclearedRow[] = [
    ...(e.data ?? []).map((r: any) => ({ kind: "Expense" as const, id: r.expid, date: r.expdate, description: r.expdscr ?? "", amount: r.expamount })),
    ...(f.data ?? []).map((r: any) => ({ kind: "Funds" as const, id: r.fndsid, date: r.fndsdate, description: [r.fndspayee, r.fndsdesc].filter(Boolean).join(" — "), amount: r.fndspmt })),
  ];
  return rows.sort((a, b) => a.date.localeCompare(b.date) || a.kind.localeCompare(b.kind) || a.id - b.id);
}

export function parseClearedDate(raw: string): string {
  const s = raw.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) throw new ClearingInputError("date");
  const d = new Date(`${s}T00:00:00Z`);
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== s) throw new ClearingInputError("date");
  return s;
}

/** Untrusted checkbox values → distinct safe integers (funds ids may be negative reversal rows). */
export function parseIds(raw: unknown[]): number[] {
  const ids = new Set<number>();
  for (const v of raw) {
    if (typeof v !== "string" || !/^-?\d{1,9}$/.test(v.trim())) continue;
    ids.add(Number(v.trim()));
  }
  return [...ids];
}

export type ClearInput = { account: string; date: string; note: string; expIds: number[]; fndsIds: number[] };
export type ClearResult = { cleared: number; skipped: number; failed: ("expenses" | "funds")[] };

export async function clearRows(db: Db, input: ClearInput): Promise<ClearResult> {
  const account = input.account.trim();
  if (!account) throw new ClearingInputError("account");
  const date = parseClearedDate(input.date);
  const total = input.expIds.length + input.fndsIds.length;
  if (total === 0) throw new ClearingInputError("none");
  if (total > MAX_SELECTED) throw new ClearingInputError("toomany");
  const note = input.note.trim();
  const res: ClearResult = { cleared: 0, skipped: 0, failed: [] };
  const parts = [
    { name: "expenses" as const, table: "tblexpenses", id: "expid", acct: "expbankaccount", flag: "expclearedbank", dt: "expdatecleared", notes: "expclearingnotes", ids: input.expIds },
    { name: "funds" as const, table: "tblfundsrcvd", id: "fndsid", acct: "fndsbankaccount", flag: "fndsclearedbank", dt: "fndsdatecleared", notes: "fndsclearingnotes", ids: input.fndsIds },
  ];
  for (const p of parts) {
    if (!p.ids.length) continue;
    // Empty note leaves existing clearing notes alone rather than wiping them.
    const payload: Record<string, unknown> = { [p.flag]: true, [p.dt]: date, ...(note ? { [p.notes]: note } : {}) };
    const { data, error } = await db.from(p.table).update(payload)
      .eq(p.acct, account).in(p.id, p.ids).not(p.flag, "is", true).select(p.id);
    if (error) {
      console.error(`clearRows ${p.table}:`, error.message);
      res.failed.push(p.name);
      continue;
    }
    const n = data?.length ?? 0;
    res.cleared += n;
    res.skipped += p.ids.length - n;
  }
  return res;
}

export type ClearingDeps = {
  session: () => Promise<Session>;
  db: () => Db;
  revalidatePath: (p: string) => void;
  redirect: (url: string) => void;
};

/** /bank-review/accounts "Mark cleared" body. Staff and admin. Always redirects back to the same account. */
export async function runClearRows(formData: FormData, deps: ClearingDeps): Promise<void> {
  await deps.session(); // /login redirect propagates
  const s = (k: string) => (typeof formData.get(k) === "string" ? String(formData.get(k)) : "");
  const account = s("account").trim();
  const qs = new URLSearchParams({ account });
  try {
    const r = await clearRows(deps.db(), {
      account, date: s("date"), note: s("note"),
      expIds: parseIds(formData.getAll("exp")), fndsIds: parseIds(formData.getAll("fnd")),
    });
    qs.set("cleared", String(r.cleared));
    qs.set("skipped", String(r.skipped));
    if (r.failed.length) qs.set("clearfailed", r.failed.join(","));
  } catch (e) {
    if (e instanceof ClearingInputError) qs.set("clearerror", e.code);
    else {
      console.error("clearRows:", e);
      qs.set("clearerror", "failed");
    }
  }
  deps.revalidatePath("/bank-review/accounts");
  deps.revalidatePath("/expenses");
  deps.revalidatePath("/funds");
  deps.redirect(`/bank-review/accounts?${qs}`);
}
