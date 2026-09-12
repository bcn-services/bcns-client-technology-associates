import Link from "next/link";
import { notFound } from "next/navigation";
import { requireSession } from "@/lib/auth/session";
import { createServerClient } from "@/lib/db/client";
import { loadInquiryOptions } from "@/lib/inquiries/inquiries";
import type { Db as CaseDb } from "@/lib/cases/record";
import { existingCaseId, loadClientOptions } from "@/lib/inquiries/convert";
import { convertInquiryAction, updateInquiryAction } from "../actions";
import { InquiryForm } from "../inquiry-form";
import { ConvertPanel } from "./convert-panel";

export const dynamic = "force-dynamic";

export default async function InquiryPage({ params, searchParams }: {
  params: { id: string };
  searchParams: { created?: string; saved?: string };
}) {
  await requireSession();
  if (!/^\d+$/.test(params.id)) notFound();
  const db = createServerClient();
  const id = Number(params.id);
  const [{ data: row, error }, options, clients, linkedCase] = await Promise.all([
    db.from("tblinquiry").select("*").eq("id", id).maybeSingle(),
    loadInquiryOptions(db),
    loadClientOptions(db as unknown as CaseDb),
    existingCaseId(db as unknown as CaseDb, { id }),
  ]);
  if (error) throw new Error(`tblinquiry: ${error.message}`);
  if (!row) notFound();
  const existingCase = linkedCase ?? row.inqresultingcase;
  // Branch from the inquiry (in the lookup's spelling); with none, the only branch when there is exactly one.
  const defaultBranch = options.branches.find((b) => b.toLowerCase() === (row.tabranch ?? "").toLowerCase())
    ?? (options.branches.length === 1 ? options.branches[0] : undefined) ?? "";

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
      <ConvertPanel
        inquiryId={row.id} existingCase={existingCase} attorneys={options.attorneys} clients={clients} branches={options.branches}
        defaultAttorney={row.inqattyid == null ? "" : String(row.inqattyid)} defaultBranch={defaultBranch} action={convertInquiryAction}
      />

      <InquiryForm action={updateInquiryAction} options={options} values={row} />
    </main>
  );
}
