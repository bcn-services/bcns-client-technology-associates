import Link from "next/link";
import { requireSession } from "@/lib/auth/session";
import { createServerClient } from "@/lib/db/client";
import type { Db } from "@/lib/time/entries";
import { FUNDS_FIELDS, fundsErrorMessage, loadFunds, rowValues, type FundsValues } from "@/lib/funds/save";
import { openBillsOldestFirst, preselectBill, billOption, payErrorMessage } from "@/lib/funds/pay";
import { findReversal, isReversal, reopenPreselect, reversalComment, reverseErrorMessage } from "@/lib/funds/reverse";
import { listCaseBills } from "@/lib/bills/case";
import { payBillAction, reverseFundsAction, updateFundsAction } from "../actions";
import { FundsForm } from "../funds-form";

export const dynamic = "force-dynamic";

type Params = Record<string, string | string[] | undefined>;
const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

/** One funds record: "Funds recorded" after a save, every field in an edit form. Later sections go below the form. */
export default async function FundsPage({ params, searchParams }: { params: { id: string }; searchParams: Params }) {
  const session = await requireSession();
  const error = first(searchParams.error);
  const id = /^-?\d{1,9}$/.test(params.id) ? Number(params.id) : 0;
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
  const linked = row.fndsbillid ?? null;
  const bills = isAdmin && linked == null && !isReversal(row) && row.fndscaseid != null ? await openBillsOldestFirst(db, row.fndscaseid) : [];
  const picked = preselectBill(bills, first(searchParams.bill));
  const payError = first(searchParams.payerror);
  const paid = first(searchParams.paid);
  const reversal = isReversal(row);
  // Only a positive, not-yet-reversed row offers the control; its Paid bills are the reopen choices.
  const reversedBy = reversal ? null : await findReversal(db, row.fndsid);
  const paidBills = isAdmin && !reversal && !reversedBy && row.fndscaseid != null
    ? (await listCaseBills(db, row.fndscaseid)).filter((b) => b.billnotice === "Paid") : [];
  const reverseError = first(searchParams.reverseerror);
  // Once linked, this line replaces the pay select (admins) and is the only bill-payment output (staff, reversal rows).
  const applied = linked != null && (
    <p data-testid="applied-bill" className="text-sm text-slate-700">Applied to bill <Link href={`/bills/${linked}`} className="underline">{linked}</Link></p>
  );
  const values = error ? (Object.fromEntries(FUNDS_FIELDS.map((k) => [k, first(searchParams[k])])) as FundsValues) : rowValues(row);
  return (
    <main className="mx-auto max-w-4xl space-y-4 px-4 py-6">
      {head}
      {first(searchParams.saved) === "1" && !error && <p role="status" className="text-sm text-green-800">Funds recorded</p>}
      <p className="text-sm">
        Case <Link href={`/cases/${row.fndscaseid}`} className="text-slate-700 underline">{row.fndscaseid}</Link>
      </p>
      {/* Key on a host element: a key on a server component (FundsForm) is dropped from the RSC payload. */}
      {row.fndsid < 0 ? (
        // Reversal rows are read-only (runUpdateFunds refuses ids ≤ 0): corrections go on the original.
        <p data-testid="reversal-note" className="text-sm text-slate-700">
          Bounced-check reversal · ${String(row.fndspmt)} · {row.fndsdate} · {row.fndscomment} (<Link href={`/funds/${-row.fndsid}`} className="underline">original</Link>)
        </p>
      ) : (
        /* Key on a host element: a key on a server component (FundsForm) is dropped from the RSC payload. */
        <section aria-label="Edit funds" key={crypto.randomUUID()}>
          <FundsForm values={values} error={error || undefined} action={updateFundsAction.bind(null, row.fndsid)} submitLabel="Save" />
        </section>
      )}
      {isAdmin && !reversal ? (
        // Key on a host element so a same-URL redirect re-renders the select with the fresh open bills.
        <section aria-label="Bill payment" key={crypto.randomUUID()} className="space-y-2 border-t pt-4">
          <h2 className="font-semibold">Bill payment</h2>
          {payError && <p role="alert" data-testid="pay-error" className="text-sm text-red-700">{payErrorMessage(payError)}</p>}
          {paid && !payError && <p role="status" data-testid="pay-saved" className="text-sm text-green-800">Bill #{paid} updated</p>}
          {applied || (bills.length === 0 ? (
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
          ))}
        </section>
      ) : applied}
      {reversedBy && (
        <p data-testid="reversed-by" className="text-sm text-slate-700">
          Reversed by <Link href={`/funds/${reversedBy.fndsid}`} className="underline">#{reversedBy.fndsid}</Link> ({reversalComment(row.fndsid)})
        </p>
      )}
      {isAdmin && (reverseError || first(searchParams.reversed) || (!reversal && !reversedBy)) && (
        <section aria-label="Bounced check" key={crypto.randomUUID()} className="space-y-2 border-t pt-4">
          <h2 className="font-semibold">Bounced check</h2>
          {first(searchParams.reversed) && !reverseError && <p role="status" data-testid="reverse-saved" className="text-sm text-green-800">Check reversed</p>}
          {reverseError && <p role="alert" data-testid="reverse-error" className="text-sm text-red-700">{reverseErrorMessage(reverseError)}</p>}
          {!reversal && !reversedBy && (
            <form action={reverseFundsAction.bind(null, row.fndsid)} className="flex flex-wrap items-end gap-2">
              <label htmlFor="reverse-bill" className="text-sm">Reopen bill</label>
              <select id="reverse-bill" name="bill" defaultValue={reopenPreselect(paidBills, linked)} className="rounded border px-2 py-1 text-sm">
                <option value="">No bill</option>
                {paidBills.map((b) => (
                  <option key={b.billid} value={String(b.billid)}>#{b.billid} · {b.billdate} · Paid · ${String(b.billbalance)}</option>
                ))}
              </select>
              <button className="rounded bg-red-800 px-3 py-1 text-sm text-white">Reverse bounced check</button>
            </form>
          )}
        </section>
      )}
    </main>
  );
}
