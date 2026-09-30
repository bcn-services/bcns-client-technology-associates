import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/session";
import { createServerClient } from "@/lib/db/client";
import { getStorageAdapter, StorageObjectNotFoundError } from "@/lib/storage";
import type { Db } from "@/lib/time/entries";
import { readStoredFile } from "@/lib/bill-docs/send";
import { saPdfKey } from "@/lib/bill-docs/service-auth";

export const dynamic = "force-dynamic";

const text = (body: string, status: number) => new NextResponse(body, { status, headers: { "content-type": "text/plain; charset=utf-8" } });

/**
 * A service authorization's stored PDF as a download, for any signed-in user (requireSession runs first, outside the
 * try, so anon gets the login redirect). Proxied bytes under the app's origin, like the invoice download.
 */
export async function GET(_req: Request, { params }: { params: { srvauthid: string } }): Promise<NextResponse> {
  await requireSession();
  if (!/^\d{1,9}$/.test(params.srvauthid)) return text("That service authorization does not exist.", 404);
  try {
    const key = await saPdfKey(createServerClient() as unknown as Db, Number(params.srvauthid));
    if (!key) return text("This service authorization has no file.", 404);
    const storage = getStorageAdapter();
    if (!storage) return text("File storage is not configured.", 503);
    const bytes = await readStoredFile(storage, key);
    const name = key.slice(key.lastIndexOf("/") + 1).replace(/"/g, "");
    return new NextResponse(Buffer.from(bytes), {
      headers: { "content-type": "application/pdf", "content-disposition": `attachment; filename="${name}"`, "cache-control": "private, no-store" },
    });
  } catch (e) {
    if (e instanceof StorageObjectNotFoundError) return text("This service authorization's file is not in the app's storage (older files are on the office drive).", 404);
    console.error("service auth pdf:", params.srvauthid, e);
    return text("The PDF could not be loaded.", 503);
  }
}
