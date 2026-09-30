import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/session";
import { createServerClient } from "@/lib/db/client";
import { getStorageAdapter, StorageObjectNotFoundError } from "@/lib/storage";
import type { Db } from "@/lib/time/entries";

export const dynamic = "force-dynamic";

const text = (body: string, status: number) => new NextResponse(body, { status, headers: { "content-type": "text/plain; charset=utf-8" } });

/**
 * The bill's stored invoice PDF, for any signed-in user. requireSession() runs first and outside the try, so an
 * anonymous request gets the app's /login redirect, never a file. The bytes are proxied (not a redirect to the
 * signed URL) so the response is always application/pdf under the app's own origin.
 */
export async function GET(_req: Request, { params }: { params: { id: string } }): Promise<NextResponse> {
  await requireSession();
  if (!/^\d{1,9}$/.test(params.id)) return text("That bill does not exist.", 404);
  try {
    const db = createServerClient() as unknown as Db;
    const { data, error } = await db.from("tblbills").select("billpdfpath, billfilename").eq("billid", Number(params.id)).maybeSingle();
    if (error) throw new Error(`tblbills read: ${error.message}`);
    const path = (data as { billpdfpath: string | null } | null)?.billpdfpath;
    if (!path) return text("This bill has no PDF yet.", 404);
    const storage = getStorageAdapter();
    if (!storage) return text("File storage is not configured.", 503);
    const res = await fetch(await storage.getSignedUrl(path, 60), { cache: "no-store" });
    if (!res.ok) throw new Error(`storage fetch ${res.status}`);
    const name = path.slice(path.lastIndexOf("/") + 1).replace(/"/g, "");
    return new NextResponse(await res.arrayBuffer(), {
      headers: { "content-type": "application/pdf", "content-disposition": `inline; filename="${name}"`, "cache-control": "private, no-store" },
    });
  } catch (e) {
    if (e instanceof StorageObjectNotFoundError) return text("The PDF file is missing from storage — use Create PDF.", 404);
    console.error("bill pdf download:", params.id, e);
    return text("The PDF could not be loaded.", 503);
  }
}
