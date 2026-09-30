/**
 * Revise an open bill B: insert B′ (supersedesbillid = B, B's type/hours/balance/estimate/comments, dated today, '1st'),
 * move B's time rows to B′ (writes ONLY actbillid — actbilled stays true, so the case's unbilled hours don't change),
 * then close B as 'Cancelled' guarded on the notice the page rendered. Any step failing → rows back to B, B′ deleted, stale.
 * B is never deleted; the only column of B written is billnotice.
 */
import type { Db } from "@/lib/time/entries";
import { firmToday } from "@/lib/cases/presets";
import { isOpen } from "./rules";
import { BillInputError } from "./edit";
import { fileNameFor } from "./create";
import { guardedUpdate, type NoticeDeps } from "./notice";

/** `expected` = the notice the page rendered. Returns B′'s billid. */
export async function reviseBill(db: Db, billid: number, expected: string, today: string): Promise<number> {
  const r = await db.from("tblbills")
    .select("billid, billcaseid, billnotice, billtype, billhours, billbalance, billestimate, billcomments")
    .eq("billid", billid).maybeSingle();
  if (r.error) throw new Error(`tblbills read: ${r.error.message}`);
  if (!r.data) throw new BillInputError("notfound");
  const b = r.data;
  if (!isOpen(b.billnotice)) throw new BillInputError("move");
  if (b.billnotice !== expected) throw new BillInputError("stale");

  const sup = await db.from("tblbills").select("billid").eq("supersedesbillid", billid).limit(1);
  if (sup.error) throw new Error(`tblbills read: ${sup.error.message}`);
  if ((sup.data ?? []).length) throw new BillInputError("revised");

  const acts = await db.from("tblactivity").select("actid").eq("actbillid", billid);
  if (acts.error) throw new Error(`tblactivity read: ${acts.error.message}`);
  const n = (acts.data ?? []).length;

  const k = await db.from("tblcase").select("caseatty").eq("caseid", b.billcaseid).maybeSingle();
  if (k.error) throw new Error(`tblcase read: ${k.error.message}`);
  const atty = k.data ? await db.from("tblattorney").select("attylastname").eq("attyid", k.data.caseatty).maybeSingle() : null;
  if (atty?.error) throw new Error(`tblattorney read: ${atty.error.message}`);
  const billfilename = await fileNameFor(db, b.billcaseid, atty?.data?.attylastname, today);

  const ins = await db.from("tblbills").insert({
    billcaseid: b.billcaseid,
    billtype: b.billtype,
    billhours: b.billhours,
    billbalance: b.billbalance,
    billestimate: b.billestimate,
    billcomments: b.billcomments,
    billdate: today,
    billnotice: "1st",
    billfilename,
    supersedesbillid: billid,
  }).select("billid").single();
  if (ins.error || !ins.data) throw new Error(`tblbills insert: ${ins.error?.message ?? "no row"}`);
  const newId = ins.data.billid as number;

  // ponytail: compensation over PostgREST, not a transaction (same caveat as createBill) — if the undo itself fails,
  // B′ is left as an orphan and logged for manual cleanup. Only rows pointing at the fresh B′ move back, so no other bill is touched.
  const undo = async () => {
    const back = await db.from("tblactivity").update({ actbillid: billid }).eq("actbillid", newId).select("actid");
    const del = await db.from("tblbills").delete().eq("billid", newId).select("billid");
    if (back.error || del.error) console.error("reviseBill compensation failed:", billid, newId, back.error, del.error);
  };

  const mv = await db.from("tblactivity").update({ actbillid: newId }).eq("actbillid", billid).select("actid");
  if (mv.error || (mv.data ?? []).length !== n) {
    await undo();
    if (mv.error) throw new Error(`tblactivity move: ${mv.error.message}`);
    throw new BillInputError("stale");
  }
  try {
    await guardedUpdate(db, billid, expected, { billnotice: "Cancelled" });
  } catch (e) {
    await undo();
    throw e;
  }
  return newId;
}

/** Body of the reviseBill server action. Admin check first (staff → forbidden, no DB call); redirects outside try. */
export async function runRevise(billid: number, formData: FormData, deps: NoticeDeps): Promise<void> {
  let code: string | null = null;
  try {
    await deps.session();
  } catch (e) {
    if (e instanceof Error && e.name === "ForbiddenError") code = "forbidden";
    else throw e;
  }
  if (!code && (!Number.isSafeInteger(billid) || billid <= 0)) code = "notfound";
  let newId = 0;
  if (!code) {
    const expected = formData.get("expected");
    try {
      newId = await reviseBill(deps.db(), billid, typeof expected === "string" ? expected : "", firmToday(deps.now()));
    } catch (e) {
      if (e instanceof BillInputError) code = e.code;
      else {
        console.error("reviseBill:", e);
        code = "failed";
      }
    }
  }
  deps.revalidatePath(`/bills/${billid}`);
  if (code) deps.redirect(`/bills/${billid}?error=${code}`);
  deps.redirect(`/bills/${newId}`);
}
