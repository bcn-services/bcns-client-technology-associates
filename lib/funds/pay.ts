/**
 * Mark a bill Paid / Partial Payment from a funds row (admin only). The write is the guardedUpdate pattern
 * (lib/bills/notice.ts) plus two more filters in the same statement: the bill is on the funds row's case, and its
 * notice is still the (open) one the page rendered. ≠ 1 row → stale. billpaiddate is the funds row's fndsdate, read here — never posted, never today.
 * Writes only billnotice (+ billpaiddate for Paid): never the notice dates, billbalance, or any tblcase column.
 *
 * Check → bill link (tblfundsrcvd.fndsbillid), two writes, no transaction. The link is the once-only guard, so it
 * goes first: `fndsbillid = N where fndsid = F and fndsbillid is null` (≠ 1 row → "linked", nothing else written).
 * Only the winner then writes the bill (guarded by expected notice). If the bill write loses, the link is undone
 * with `where fndsid = F and fndsbillid = N` (row count checked) — only on a definite loss (no error, 0 rows); an
 * erroring bill write may have committed, so the link is kept ("failed"). A bill is therefore never Paid by this
 * action without its link; the residuals (failed compensation, or an error on a bill write that did not commit)
 * leave a link on an unchanged bill — never a Paid bill that row did not pay. Case match (bill vs funds row) is checked before either write.
 */
import type { Session } from "../auth/session";
import type { Db } from "../time/entries";
import { listCaseBills, type CaseBillRow } from "../bills/case";
import { isOpen } from "../bills/rules";

export class PayError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = "PayError";
  }
}

const MESSAGES: Record<string, string> = {
  stale: "This bill changed meanwhile — reload and try again",
  bill: "Pick an open bill on this case.",
  linked: "This check is already applied to a bill.",
  notfound: "That funds record no longer exists.",
  forbidden: "Only an admin can mark bills paid.",
};
export const payErrorMessage = (code: string): string => MESSAGES[code] ?? "Update failed; the bill was not changed.";

/** The case's open bills, oldest first (listCaseBills is newest first). */
export async function openBillsOldestFirst(db: Db, caseId: number): Promise<CaseBillRow[]> {
  return (await listCaseBills(db, caseId)).filter((b) => isOpen(b.billnotice)).reverse();
}

/** `?bill=` preselect: only an exact-id match among `open` (this row's case, open only); anything else → oldest. */
export const preselectBill = (open: CaseBillRow[], want: string): CaseBillRow | undefined =>
  open.find((b) => String(b.billid) === want) ?? open[0];

/** Select value: `<billid>:<notice at render time>` — the notice is the write's `expected` guard. */
export const billOption = (b: Pick<CaseBillRow, "billid" | "billnotice">) => `${b.billid}:${b.billnotice}`;

export async function payBill(db: Db, fndsid: number, billid: number, expected: string, kind: "paid" | "partial"): Promise<number> {
  if (!Number.isSafeInteger(billid) || billid <= 0 || !isOpen(expected)) throw new PayError("bill");
  const f = await db.from("tblfundsrcvd").select("fndscaseid, fndsdate, fndsbillid").eq("fndsid", fndsid).maybeSingle();
  if (f.error) throw new Error(`tblfundsrcvd read: ${f.error.message}`);
  if (!f.data || f.data.fndscaseid == null) throw new PayError("notfound");
  if (f.data.fndsbillid != null) throw new PayError("linked");
  const caseId: number = f.data.fndscaseid;
  const b = await db.from("tblbills").select("billcaseid").eq("billid", billid).maybeSingle();
  if (b.error) throw new Error(`tblbills read: ${b.error.message}`);
  if (!b.data || b.data.billcaseid !== caseId) throw new PayError("bill");

  const link = await db.from("tblfundsrcvd").update({ fndsbillid: billid })
    .eq("fndsid", fndsid).eq("fndscaseid", caseId).is("fndsbillid", null).select("fndsid");
  if (link.error) throw new Error(`tblfundsrcvd link: ${link.error.message}`);
  if (!link.data || link.data.length !== 1) throw new PayError("linked");

  const payload = kind === "paid" ? { billnotice: "Paid", billpaiddate: f.data.fndsdate as string } : { billnotice: "Partial Payment" };
  const { data, error } = await db.from("tblbills").update(payload)
    .eq("billid", billid).eq("billcaseid", caseId).eq("billnotice", expected)
    .select("billid");
  // An error is ambiguous (the update may have committed): keep the link rather than risk a Paid bill without it.
  if (error) throw new Error(`tblbills pay update (link kept): fndsid ${fndsid} → bill ${billid}: ${error.message}`);
  if (!data || data.length !== 1) {
    const undo = await db.from("tblfundsrcvd").update({ fndsbillid: null })
      .eq("fndsid", fndsid).eq("fndsbillid", billid).select("fndsid");
    if (undo.error || undo.data?.length !== 1) throw new Error(`tblfundsrcvd unlink after lost bill write failed: fndsid ${fndsid} → bill ${billid}`);
    throw new PayError("stale");
  }
  return caseId;
}

export type PayDeps = {
  session: () => Promise<Session>;
  db: () => Db;
  revalidatePath: (p: string) => void;
  redirect: (url: string) => void;
};

/** /funds/[id] pay action body. Admin check first (no DB call for staff). Success → ?paid=<billid>; refusal → ?payerror=<code>. */
export async function runPayBill(fndsid: number, formData: FormData, deps: PayDeps): Promise<void> {
  let code: string | null = null;
  let billid = 0;
  let caseId: number | null = null;
  try {
    const s = await deps.session();
    if (s.role !== "admin") code = "forbidden";
  } catch (e) {
    if (e instanceof Error && e.name === "ForbiddenError") code = "forbidden";
    else throw e; // /login redirect must propagate
  }
  if (!code) {
    const raw = formData.get("bill");
    const m = typeof raw === "string" ? /^(\d{1,9}):(.+)$/.exec(raw) : null;
    const kind = formData.get("kind");
    try {
      if (!Number.isSafeInteger(fndsid) || fndsid <= 0) throw new PayError("notfound");
      if (!m || (kind !== "paid" && kind !== "partial")) throw new PayError("bill");
      billid = Number(m[1]);
      caseId = await payBill(deps.db(), fndsid, billid, m[2]!, kind);
    } catch (e) {
      if (e instanceof PayError) code = e.code;
      else {
        console.error("payBill:", e);
        code = "failed";
      }
    }
  }
  deps.revalidatePath(`/funds/${fndsid}`);
  if (!code) {
    deps.revalidatePath("/bills");
    deps.revalidatePath(`/bills/${billid}`);
    deps.revalidatePath(`/cases/${caseId}`);
  }
  deps.redirect(code ? `/funds/${fndsid}?payerror=${code}` : `/funds/${fndsid}?paid=${billid}`);
}
