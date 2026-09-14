import Link from "next/link";
import { requireSession } from "@/lib/auth/session";
import { createServerClient } from "@/lib/db/client";
import type { Db } from "@/lib/time/entries";
import { FUNDS_FIELDS, fundsErrorMessage, loadFunds, rowValues, type FundsValues } from "@/lib/funds/save";
import { updateFundsAction } from "../actions";
import { FundsForm } from "../funds-form";

export const dynamic = "force-dynamic";

type Params = Record<string, string | string[] | undefined>;
const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

/** One funds record: "Funds recorded" after a save, every field in an edit form. Later sections go below the form. */
export default async function FundsPage({ params, searchParams }: { params: { id: string }; searchParams: Params }) {
  await requireSession();
  const error = first(searchParams.error);
  const id = /^\d{1,9}$/.test(params.id) ? Number(params.id) : 0;
  const row = id ? await loadFunds(createServerClient() as unknown as Db, id) : null;
  const head = (
    <>
      <p className="text-sm"><Link href="/funds" className="text-slate-700 underline">← Funds</Link></p>
      <h1 className="text-xl font-semibold">Funds #{params.id}</h1>
    </>
  );
  if (!row) {
    return (
      <main className="mx-auto max-w-4xl space-y-4 px-4 py-6">
        {head}
        {error && <p role="alert" className="text-sm text-red-700">{fundsErrorMessage(error)}</p>}
        <p role="alert" className="text-sm text-slate-700">Not found</p>
      </main>
    );
  }
  const values = error ? (Object.fromEntries(FUNDS_FIELDS.map((k) => [k, first(searchParams[k])])) as FundsValues) : rowValues(row);
  return (
    <main className="mx-auto max-w-4xl space-y-4 px-4 py-6">
      {head}
      {first(searchParams.saved) === "1" && !error && <p role="status" className="text-sm text-green-800">Funds recorded</p>}
      <p className="text-sm">
        Case <Link href={`/cases/${row.fndscaseid}`} className="text-slate-700 underline">{row.fndscaseid}</Link>
      </p>
      <section aria-label="Edit funds">
        <FundsForm key={crypto.randomUUID()} values={values} error={error || undefined} action={updateFundsAction.bind(null, row.fndsid)} submitLabel="Save" />
      </section>
    </main>
  );
}
