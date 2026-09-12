import { notFound } from "next/navigation";
import { requireSession } from "@/lib/auth/session";
import { createServerClient } from "@/lib/db/client";
import { loadCaseRecord, rolodexLines, type Db } from "@/lib/cases/record";

export const dynamic = "force-dynamic";

/** Print-ready rolodex card: attorney last-name-first, firm, address, phone, fax. Missing rows print blank. */
export default async function CaseRolodexPage({ params }: { params: { id: string } }) {
  await requireSession();
  if (!/^\d{1,9}$/.test(params.id)) notFound();
  const rec = await loadCaseRecord(createServerClient() as unknown as Db, Number(params.id));
  if (!rec) notFound();
  const lines = rolodexLines(rec.atty, rec.firm);

  return (
    <main className="mx-auto max-w-6xl space-y-4 px-4 py-6">
      <style>{`@media print { header, .no-print { display: none !important; } main { padding: 0 !important; } }`}</style>
      <p className="no-print text-sm text-slate-600">
        Rolodex card for case {String(rec.kase.caseid)}. Use your browser&apos;s Print (Ctrl/Cmd+P).
      </p>
      {lines.length ? (
        <address data-testid="rolodex-card" className="min-h-[2.25in] w-[4in] whitespace-pre-line rounded border border-slate-300 p-4 not-italic leading-snug">
          {lines.join("\n")}
        </address>
      ) : (
        <p role="alert" className="text-sm text-red-700">No attorney or firm on file for this case.</p>
      )}
    </main>
  );
}
