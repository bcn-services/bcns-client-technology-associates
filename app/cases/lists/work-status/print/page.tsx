import { requireSession } from "@/lib/auth/session";
import { createServerClient } from "@/lib/db/client";
import { workStatus } from "@/lib/cases/presets";
import { ErrorNote } from "../../ui";
import { WorkStatusTable, readParams } from "../table";

export const dynamic = "force-dynamic";

export default async function WorkStatusPrintPage({ searchParams }: { searchParams: Record<string, string | string[] | undefined> }) {
  await requireSession();
  const db = createServerClient();
  const { pm, sort } = readParams(searchParams);
  const [result] = await Promise.all([workStatus(db, pm, sort)]);
  return (
    <main className="mx-auto max-w-6xl space-y-3 px-4 py-6 print:max-w-none print:p-0">
      {/* Hide the app chrome on paper. */}
      <style>{"@media print { header, nav, footer { display: none !important; } @page { margin: 12mm; } }"}</style>
      <h1 className="text-lg font-semibold">
        Work Status — {pm || "all point men"}, {sort === "due" ? "due date first" : "by priority"}
      </h1>
      {"error" in result ? <ErrorNote message={result.error} /> : <WorkStatusTable rows={result.rows} />}
    </main>
  );
}
