import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/session";
import { createServerClient } from "@/lib/db/client";
import type { Db } from "@/lib/time/entries";
import { caseDoc, loadCaseDocValues } from "@/lib/case-docs/docs";
import { fillTemplate } from "@/lib/case-docs/fill";
import { TEMPLATE_DOTX } from "@/lib/case-docs/templates";
import { firmToday } from "@/lib/cases/presets";

export const dynamic = "force-dynamic";

const text = (body: string, status: number) => new NextResponse(body, { status, headers: { "content-type": "text/plain; charset=utf-8" } });

/**
 * One of the four case documents (Memo, CTA Report, File Review Summary, Inspection Plan), filled with the case's
 * values and returned as a Word download for any signed-in user. requireSession runs first, outside the try, so anon
 * gets the login redirect. Built per request; nothing is stored.
 */
export async function GET(_req: Request, { params }: { params: { id: string; doc: string } }): Promise<NextResponse> {
  await requireSession();
  const kind = caseDoc(params.doc);
  if (!kind) return text("There is no such case document.", 404);
  if (!/^\d{1,9}$/.test(params.id)) return text("That case does not exist.", 404);
  const caseId = Number(params.id);
  try {
    const now = new Date();
    const values = await loadCaseDocValues(createServerClient() as unknown as Db, caseId, kind.slug, now);
    if (!values) return text("That case does not exist.", 404);
    const bytes = await fillTemplate(Buffer.from(TEMPLATE_DOTX[kind.template], "base64"), values, now, firmToday(now));
    const name = kind.fileName(caseId);
    return new NextResponse(Buffer.from(bytes), {
      headers: {
        "content-type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "content-disposition": `attachment; filename="${name.replace(/"/g, "")}"; filename*=UTF-8''${encodeURIComponent(name)}`,
        "cache-control": "private, no-store",
      },
    });
  } catch (e) {
    console.error("case document:", params.id, params.doc, e);
    return text("The document could not be built.", 503);
  }
}
