/**
 * `GET /reports/export?start=&end=&preset=` — the same three parameters the `/reports` form submits, answered
 * with the workbook instead of the page. Lives under `app/reports/` on purpose: Next resolves a route handler
 * at any segment, and this lane owns `app/reports/**`.
 *
 * Read-only. `requireSession()` gates it exactly as the page does, and no branch here writes.
 */
import { requireSession } from "@/lib/auth/session";
import { createServerClient } from "@/lib/db/client";
import type { Db } from "@/lib/time/entries";
import { buildWorkbook, workbookFilename, XLSX_MIME } from "@/lib/reports/export";
import { findPreset, isRangeFor, type Range } from "@/lib/reports/presets";

export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  await requireSession();
  const q = new URL(request.url).searchParams;
  const preset = findPreset(q.get("preset") ?? "");
  const range: Range = { start: q.get("start") ?? "", end: q.get("end") ?? "" };
  if (!preset || !isRangeFor(preset, range)) {
    return new Response("Choose a report and a real start and end date, with the start on or before the end.", {
      status: 400,
      headers: { "content-type": "text/plain; charset=utf-8" },
    });
  }
  const wb = await buildWorkbook(createServerClient() as unknown as Db, preset, range);
  const body = await wb.xlsx.writeBuffer();
  return new Response(body as ArrayBuffer, {
    headers: {
      "content-type": XLSX_MIME,
      "content-disposition": `attachment; filename="${workbookFilename(preset, range)}"`,
      "cache-control": "no-store",
    },
  });
}
