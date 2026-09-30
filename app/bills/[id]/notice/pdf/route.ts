import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/session";
import { createServerClient } from "@/lib/db/client";
import { getStorageAdapter, StorageObjectNotFoundError } from "@/lib/storage";
import type { Db } from "@/lib/time/entries";
import { canSendNotice } from "@/lib/bills/rules";
import { noticeBlockCode, sendErrorMessage } from "@/lib/bills/send";
import { readStoredFile } from "@/lib/bill-docs/send";
import { noticeKey, stampNotice } from "@/lib/bill-docs/notice";

export const dynamic = "force-dynamic";

const text = (body: string, status: number) => new NextResponse(body, { status, headers: { "content-type": "text/plain; charset=utf-8" } });

/**
 * The notice preview PDF: the stored invoice with the bill's current notice stamp, rendered on request and NOT saved
 * (the send saves it). Any signed-in user, like the invoice download; works with no email keys.
 */
export async function GET(_req: Request, { params }: { params: { id: string } }): Promise<NextResponse> {
  await requireSession();
  if (!/^\d{1,9}$/.test(params.id)) return text("That bill does not exist.", 404);
  try {
    const db = createServerClient() as unknown as Db;
    const { data, error } = await db.from("tblbills").select("billtype, billnotice, billfinalizedat, billpdfpath").eq("billid", Number(params.id)).maybeSingle();
    if (error) throw new Error(`tblbills read: ${error.message}`);
    if (!data) return text("That bill does not exist.", 404);
    const bill = data as { billtype: string | null; billnotice: string; billfinalizedat: string | null; billpdfpath: string | null };
    if (!canSendNotice(bill)) return text(sendErrorMessage(noticeBlockCode(bill)), 404);
    const storage = getStorageAdapter();
    if (!storage) return text("File storage is not configured.", 503);
    const pdf = await stampNotice(await readStoredFile(storage, bill.billpdfpath!), bill.billnotice);
    const name = noticeKey(bill.billpdfpath!, bill.billnotice).split("/").pop()!.replace(/"/g, "");
    return new NextResponse(Buffer.from(pdf), {
      headers: { "content-type": "application/pdf", "content-disposition": `inline; filename="${name}"`, "cache-control": "private, no-store" },
    });
  } catch (e) {
    if (e instanceof StorageObjectNotFoundError) return text("The invoice PDF is missing from storage — use Re-create PDF.", 404);
    console.error("bill notice pdf:", params.id, e);
    return text("The notice PDF could not be made.", 503);
  }
}
