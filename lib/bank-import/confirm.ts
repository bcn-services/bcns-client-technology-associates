/**
 * Review inbox: confirm one bank_transactions row into a cleared tblexpenses row and link it.
 * Order is insert-then-guarded-link: `update bank_transactions set expid = new where id = X and expid is null and
 * fndsid is null` must touch exactly 1 row. A loser (concurrent double confirm) deletes ONLY the expense it just
 * inserted, by its returned expid — never by a filter — so the ledger keeps exactly one expense per transaction.
 */
import type { Db } from "../time/entries";
import type { Session } from "../auth/session";
import { ExpenseInputError, expenseErrorMessage, insertExpense } from "../expenses/save";

const MESSAGES: Record<string, string> = {
  notfound: "That transaction no longer exists.",
  done: "That transaction was already confirmed.",
  type: "Pick an active expense type.",
};
export const confirmErrorMessage = (code: string): string => MESSAGES[code] ?? expenseErrorMessage(code);

export const INBOX_COLS = "id, bankaccount, postedon, amount, description, expid, fndsid";
export type BankTx = { id: number; bankaccount: string; postedon: string; amount: number | string; description: string; expid: number | null; fndsid: number | null };

/** Transactions with neither an expense nor a funds link, oldest first. */
export const INBOX_LIMIT = 500;
export async function listInbox(db: Db): Promise<BankTx[]> {
  // ponytail: capped at INBOX_LIMIT rows (page says so), no paging — add paging if Kris ever has that many unreviewed.
  const { data, error } = await db.from("bank_transactions").select(INBOX_COLS)
    .is("expid", null).is("fndsid", null).order("postedon").order("id").limit(INBOX_LIMIT);
  if (error) throw new Error(`bank_transactions read: ${error.message}`);
  return data ?? [];
}

/** Past (description, type) pairs feeding suggestType. */
export async function listPastTypes(db: Db): Promise<{ expdscr: string | null; exptype: number | null }[]> {
  // ponytail: most recent 5000 typed expenses — move matching into SQL if the ledger outgrows it.
  const { data, error } = await db.from("tblexpenses").select("expdscr, exptype")
    .not("exptype", "is", null).order("expid", { ascending: false }).limit(5000);
  if (error) throw new Error(`tblexpenses read: ${error.message}`);
  return data ?? [];
}

export type ConfirmInput = { case: string; type: string; dscr: string };

/** Returns the new expid. Throws ExpenseInputError(code) for refusals. */
export async function confirmTransaction(db: Db, txid: number, input: ConfirmInput): Promise<number> {
  if (!Number.isSafeInteger(txid) || txid <= 0) throw new ExpenseInputError("notfound");
  const r = await db.from("bank_transactions").select(INBOX_COLS).eq("id", txid).maybeSingle();
  if (r.error) throw new Error(`bank_transactions read: ${r.error.message}`);
  const tx = r.data as BankTx | null;
  if (!tx) throw new ExpenseInputError("notfound");
  if (tx.expid != null || tx.fndsid != null) throw new ExpenseInputError("done");
  if (!input.type.trim()) throw new ExpenseInputError("type");

  // insertExpense parses, checks case exists + type active, then inserts — all before the link. Inserted UNCLEARED:
  // if a loser's compensating delete fails, its orphan never reaches the cleared view.
  const expid = await insertExpense(db, {
    date: tx.postedon, dscr: input.dscr, checknum: "0", type: input.type, branch: "Stratford",
    amount: String(tx.amount).trim().replace(/^-/, ""), reason: "", init: "", case: input.case, bill: "",
    cleared: "", datecleared: "", bankaccount: tx.bankaccount, clearingnotes: "", scanned: "", notcounted: "",
  });

  const link = await db.from("bank_transactions").update({ expid })
    .eq("id", txid).is("expid", null).is("fndsid", null).select("id");
  if (!link.error && link.data?.length === 1) {
    // Won the link: only now mark it cleared. On failure the row stays linked (never delete a linked row) and uncleared.
    const clr = await db.from("tblexpenses").update({ expclearedbank: true, expdatecleared: tx.postedon }).eq("expid", expid);
    if (clr.error) throw new Error(`tblexpenses clear expid ${expid} (linked, left uncleared): ${clr.error.message}`);
    return expid;
  }

  // Lost the race (or the link failed): remove this request's own just-inserted row, by id only.
  const del = await db.from("tblexpenses").delete().eq("expid", expid);
  if (del.error) console.error(`confirm: uncleared orphan tblexpenses expid ${expid} not removed:`, del.error.message);
  if (link.error) throw new Error(`bank_transactions link: ${link.error.message}`);
  throw new ExpenseInputError("done");
}

export type ConfirmDeps = {
  session: () => Promise<Session>;
  db: () => Db;
  revalidatePath: (p: string) => void;
  redirect: (url: string) => void;
};

/** /bank-review confirm action body. Staff and admin (session only). Success → ?cleared=<expid>; refusal → ?confirmerror=<code>&confirmtx=<id>. */
export async function runConfirmTransaction(formData: FormData, deps: ConfirmDeps): Promise<void> {
  await deps.session(); // /login redirect propagates
  const s = (k: string) => (typeof formData.get(k) === "string" ? String(formData.get(k)) : "");
  const rawTx = s("tx");
  const txid = /^\d{1,9}$/.test(rawTx) ? Number(rawTx) : 0;
  let code: string | null = null;
  let expid = 0;
  try {
    expid = await confirmTransaction(deps.db(), txid, { case: s("case"), type: s("type"), dscr: s("dscr") });
  } catch (e) {
    if (e instanceof ExpenseInputError) code = e.code;
    else {
      console.error("confirmTransaction:", e);
      code = "failed";
    }
  }
  deps.revalidatePath("/bank-review");
  if (code) return deps.redirect(`/bank-review?${new URLSearchParams({ confirmerror: code, confirmtx: String(txid) })}`);
  deps.revalidatePath("/expenses");
  deps.redirect(`/bank-review?cleared=${expid}`);
}
