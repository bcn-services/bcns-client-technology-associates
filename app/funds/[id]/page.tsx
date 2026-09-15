import Link from "next/link";
import { requireSession } from "@/lib/auth/session";
import { createServerClient } from "@/lib/db/client";
import type { Db } from "@/lib/time/entries";
import { FUNDS_FIELDS, fundsErrorMessage, loadFunds, rowValues, type FundsValues } from "@/lib/funds/save";
import { openBillsOldestFirst, billOption, payErrorMessage } from "@/lib/funds/pay";
import { payBillAction, updateFundsAction } from "../actions";
import { FundsForm } from "../funds-form";

export const dynamic = "force-dynamic";

type Params = Record<string, string | string[] | undefined>;
const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

/** One funds record: "Funds recorded" after a save, every field in an edit form. Later sections go below the form. */
export default async function FundsPage({ params, searchParams }: { params: { id: string }; searchParams: Params }) {
  const session = await requireSession();
  const error = first(searchParams.error);
  const id = /^\d{1,9}$/.test(params.id) ? Number(params.id) : 0;
  const db = createServerClient() as unknown as Db;
  const row = id ? await loadFunds(db, id) : null;
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
  const isAdmin = session.role === "admin";
  const bills = isAdmin && row.fndscaseid != null ? await openBillsOldestFirst(db, row.fndscaseid) : [];
  const want = first(searchParams.bill);
  const picked = bills.find((b) => String(b.billid) === want) ?? bills[0];
  const payError = first(searchParams.payerror);
  const paid = first(searchParams.paid);
  const values = error ? (Object.fromEntries(FUNDS_FIELDS.map((k) => [k, first(searchParams[k])])) as FundsValues) : rowValues(row);
  return (
    <main className="mx-auto max-w-4xl space-y-4 px-4 py-6">
      {head}
      {first(searchParams.saved) === "1" && !error && <p role="status" className="text-sm text-green-800">Funds recorded</p>}
      <p className="text-sm">
        Case <Link href={`/cases/${row.fndscaseid}`} className="text-slate-700 underline">{row.fndscaseid}</Link>
      </p>
      {/* Key on a host element: a key on a server component (FundsForm) is dropped from the RSC payload. */}
      <section aria-label="Edit funds" key={crypto.randomUUID()}>
        <FundsForm values={values} error={error || undefined} action={updateFundsAction.bind(null, row.fndsid)} submitLabel="Save" />
      </section>
      {isAdmin && (
        // Key on a host element so a same-URL redirect re-renders the select with the fresh open bills.
        <section aria-label="Bill payment" key={crypto.randomUUID()} className="space-y-2 border-t pt-4">
          <h2 className="font-semibold">Bill payment</h2>
          {payError && <p role="alert" data-testid="pay-error" className="text-sm text-red-700">{payErrorMessage(payError)}</p>}
          {paid && !payError && <p role="status" data-testid="pay-saved" className="text-sm text-green-800">Bill #{paid} updated</p>}
          {bills.length === 0 ? (
            <p data-testid="no-open-bills" className="text-sm text-slate-700">No open bills on this case</p>
          ) : (
            <form action={payBillAction.bind(null, row.fndsid)} className="flex flex-wrap items-end gap-2">
              <label htmlFor="pay-bill" className="text-sm">Bill</label>
              <select id="pay-bill" name="bill" defaultValue={picked ? billOption(picked) : undefined} className="rounded border px-2 py-1 text-sm">
                  {bills.map((b) => (
                    <option key={b.billid} value={billOption(b)}>#{b.billid} · {b.billdate} · {b.billnotice} · ${String(b.billbalance)}</option>
                  ))}
              </select>
              <button name="kind" value="paid" className="rounded bg-slate-800 px-3 py-1 text-sm text-white">Mark bill paid</button>
              <button name="kind" value="partial" className="rounded border px-3 py-1 text-sm">Record partial payment</button>
            </form>
          )}
        </section>
      )}
    </main>
  );
}
