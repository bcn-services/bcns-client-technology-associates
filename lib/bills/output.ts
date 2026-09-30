/**
 * Bill output on the case Bills panel and /bills (billing-output item 8): each typed bill's state (Draft / Finalized /
 * Sent <date>) and which of Download / Finalize / Send / Send notice apply. Eligibility is the rules.ts functions the
 * bill page, the pages and the actions use; this only gathers their inputs. Legacy bills (billtype null) get no entry,
 * so they render exactly as before. Staff get state + Download only, and cost no extra read.
 */
import type { Db } from "@/lib/time/entries";
import { canFinalizeBill, canSendBill, canSendNotice } from "./rules";
import { brokenFinalize, storedLinesFor } from "./finalize";
import { finalizedOn } from "./finalize-model";

export type OutputBill = {
  billid: number; billtype: string | null; billnotice: string; billhours: number | string; billbalance: number | string;
  billfinalizedat: string | null; billpdfpath: string | null; billsentat: string | null;
};
export type BillOutput = {
  state: string;
  /** A stored invoice PDF: anyone may download it. */
  download: boolean;
  /** Admin-only actions; always false for staff. */
  finalize: boolean;
  send: boolean;
  sendNotice: boolean;
  /** Emailed before: Send opens as "send again". */
  sent: boolean;
};

export const billState = (b: Pick<OutputBill, "billfinalizedat" | "billsentat">): string =>
  b.billsentat ? `Sent ${finalizedOn(b.billsentat)}` : b.billfinalizedat ? "Finalized" : "Draft";

/**
 * billid → output for each typed bill. For an admin, two batched reads feed the rules: revisions of the unfinalized
 * bills (canFinalizeBill) and the saved lines of the finalized bills with a PDF (canSendBill's `broken`).
 */
export async function loadBillOutput(db: Db, bills: OutputBill[], admin: boolean): Promise<Map<number, BillOutput>> {
  const typed = bills.filter((b) => b.billtype != null);
  const drafts = admin ? typed.filter((b) => !b.billfinalizedat).map((b) => b.billid) : [];
  const withPdf = admin ? typed.filter((b) => b.billfinalizedat && b.billpdfpath).map((b) => b.billid) : [];
  const [rev, lines] = await Promise.all([
    drafts.length ? db.from("tblbills").select("supersedesbillid").in("supersedesbillid", drafts) : { data: [], error: null },
    storedLinesFor(db, withPdf),
  ]);
  if (rev.error) throw new Error(`tblbills revisions read: ${rev.error.message}`);
  const revised = new Set((rev.data ?? []).map((r: { supersedesbillid: number | null }) => r.supersedesbillid));
  return new Map(typed.map((b) => [b.billid, {
    state: billState(b),
    download: !!b.billpdfpath,
    finalize: admin && canFinalizeBill(b, revised.has(b.billid)),
    send: admin && lines.has(b.billid) && canSendBill(b, brokenFinalize(b, lines.get(b.billid)!)),
    sendNotice: admin && canSendNotice(b),
    sent: !!b.billsentat,
  }]));
}
