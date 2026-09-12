import { notFound } from "next/navigation";
import { requireSession } from "@/lib/auth/session";
import { createServerClient } from "@/lib/db/client";
import { labelLines } from "@/lib/cases/search";

export const dynamic = "force-dynamic";

/** Print-ready mailing label for a case's attorney. Missing attorney/firm rows degrade to what exists. */
export default async function CaseLabelPage({ params }: { params: { id: string } }) {
  await requireSession();
  const id = Number(params.id);
  if (!Number.isInteger(id) || id <= 0) notFound();
  const db = createServerClient();
  const { data: kase, error } = await db.from("tblcase").select("caseid, casetitle, caseatty").eq("caseid", id).maybeSingle();
  if (error) throw new Error(`tblcase: ${error.message}`);
  if (!kase) notFound();
  const { data: atty, error: attyError } = await db.from("tblattorney")
    .select("attytitle, attyfirstname, attymiddlename, attylastname, attysuffix, attyesq, attyfirmid").eq("attyid", kase.caseatty).maybeSingle();
  if (attyError) throw new Error(`tblattorney: ${attyError.message}`);
  const { data: firm, error: firmError } = atty
    ? await db.from("tblfirm").select("frmname, frmaddress1, frmaddress2, frmcity, frmstate, frmzip").eq("frmid", atty.attyfirmid).maybeSingle()
    : { data: null, error: null };
  if (firmError) throw new Error(`tblfirm: ${firmError.message}`);
  const lines = labelLines(atty, firm);

  return (
    <main className="mx-auto max-w-6xl space-y-4 px-4 py-6">
      {/* Print only the label: hide the app header and this page's chrome. */}
      <style>{`@media print { header, .no-print { display: none !important; } main { padding: 0 !important; } }`}</style>
      <p className="no-print text-sm text-slate-600">
        Label for case {kase.caseid} — {kase.casetitle}. Use your browser&apos;s Print (Ctrl/Cmd+P).
      </p>
      {lines.length ? (
        <address data-testid="address-label" className="w-[4in] whitespace-pre-line rounded border border-slate-300 p-4 not-italic leading-snug print:border-0">
          {lines.join("\n")}
        </address>
      ) : (
        <p role="alert" className="text-sm text-red-700">No attorney or firm address on file for this case.</p>
      )}
    </main>
  );
}
