import Link from "next/link";
import { notFound } from "next/navigation";
import { requireSession } from "@/lib/auth/session";
import { createServerClient } from "@/lib/db/client";
import { loadInquiryOptions } from "@/lib/inquiries/inquiries";
import { updateInquiryAction } from "../actions";
import { InquiryForm } from "../inquiry-form";

export const dynamic = "force-dynamic";

export default async function InquiryPage({ params, searchParams }: {
  params: { id: string };
  searchParams: { created?: string; saved?: string };
}) {
  await requireSession();
  if (!/^\d+$/.test(params.id)) notFound();
  const db = createServerClient();
  const [{ data: row, error }, options] = await Promise.all([
    db.from("tblinquiry").select("*").eq("id", Number(params.id)).maybeSingle(),
    loadInquiryOptions(db),
  ]);
  if (error) throw new Error(`tblinquiry: ${error.message}`);
  if (!row) notFound();

  return (
    <main className="mx-auto max-w-6xl space-y-6 px-4 py-6">
      <div className="flex items-baseline justify-between">
        <h1 className="text-xl font-semibold">Inquiry {row.id}</h1>
        <Link href="/inquiries" className="text-sm text-slate-600 hover:underline">All inquiries</Link>
      </div>
      {searchParams.created && <p role="status" className="rounded border border-emerald-300 bg-emerald-50 p-2 text-sm">Inquiry created</p>}
      {searchParams.saved && <p role="status" className="rounded border border-emerald-300 bg-emerald-50 p-2 text-sm">Inquiry saved</p>}
      <p className="text-sm">
        Resulting case:{" "}
        <span data-testid="resulting-case">
          {row.inqresultingcase == null ? "none" : <Link href={`/cases/${row.inqresultingcase}`} className="underline">{row.inqresultingcase}</Link>}
        </span>
      </p>
      {/* Item 8 (convert to case): the "Case attorney" / "Case client" pickers and the "Convert to case" button go here. */}
      <InquiryForm action={updateInquiryAction} options={options} values={row} />
    </main>
  );
}
