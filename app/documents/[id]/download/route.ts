import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/session";
import { createServerClient } from "@/lib/db/client";
import { getConfig } from "@/lib/env";
import { getStorageAdapter, StorageObjectNotFoundError } from "@/lib/storage";
import type { Db } from "@/lib/time/entries";
import { DocumentError, documentDownloadUrl, documentErrorMessage, isLegacyFile, loadDocument } from "@/lib/documents/store";
import { legacyFileResponse, resolveLegacyFile } from "@/lib/documents/legacy";

export const dynamic = "force-dynamic";

const text = (body: string, status: number) => new NextResponse(body, { status, headers: { "content-type": "text/plain; charset=utf-8" } });

/**
 * Download one document: authorize the row, then hand back a short-lived signed URL (app files) or stream
 * the NAS copy (legacy scans, when LEGACY_DOCS_DIR is set). Both go through the same loadDocument scope check.
 * requireSession() runs FIRST and outside the try, so an anonymous request gets the
 * app's normal /login redirect and never a file.
 */
export async function GET(req: Request, { params }: { params: { id: string } }): Promise<NextResponse> {
  const session = await requireSession();
  const raw = new URL(req.url).searchParams.get("case");
  const scope = raw == null || raw === "" ? null : Number(raw);
  // An unparseable scope narrows to nothing rather than being ignored (ignoring it would widen access).
  if (scope != null && !Number.isSafeInteger(scope)) return text(documentErrorMessage("notfound"), 404);
  try {
    const doc = await loadDocument(createServerClient() as unknown as Db, session, Number(params.id), scope);
    if (isLegacyFile(doc.filename)) {
      // Unconfigured stays the "open it on the NAS" note; a configured copy that lacks the file is a plain not-found.
      const dir = getConfig().legacyDocsDir;
      if (!dir) throw new DocumentError("legacy");
      const file = await resolveLegacyFile(dir, "scan", doc.filename!);
      const res = file && (await legacyFileResponse(file));
      if (!res) throw new DocumentError("notfound");
      return res;
    }
    return NextResponse.redirect(await documentDownloadUrl(getStorageAdapter(), doc), 302);
  } catch (e) {
    if (e instanceof DocumentError) return text(documentErrorMessage(e.code), e.code === "storage" ? 503 : 404);
    // A missing OBJECT is 404; every other storage fault (missing bucket, bad key,
    // backend down) is 503 — never reported to the user as "no such document".
    if (e instanceof StorageObjectNotFoundError) return text(documentErrorMessage("notfound"), 404);
    console.error("document download:", e);
    return text(documentErrorMessage("storage"), 503);
  }
}
