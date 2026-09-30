import { requireSession } from "@/lib/auth/session";
import { createServerClient } from "@/lib/db/client";
import type { Db } from "@/lib/time/entries";
import { firmToday } from "@/lib/cases/presets";
import { LIST_LIMIT, MAX_SELECTED, clearingErrorMessage, listAccounts, listUncleared } from "@/lib/bank-import/clearing";
import { clearRowsAction } from "../actions";

export const dynamic = "force-dynamic";

type Params = Record<string, string | string[] | undefined>;
const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
const count = (v: string) => (/^\d{1,9}$/.test(v) ? Number(v) : null);

/** Clearing view by bank account: mark an account's uncleared expenses and funds as cleared by the bank. */
export default async function ClearingPage({ searchParams }: { searchParams: Params }) {
  await requireSession();
  const account = first(searchParams.account).trim();
  const clearError = first(searchParams.clearerror);
  const cleared = count(first(searchParams.cleared));
  const skipped = count(first(searchParams.skipped));
  const failed = first(searchParams.clearfailed).split(",").filter((f) => f === "expenses" || f === "funds");

  const db = createServerClient() as unknown as Db;
  const [accounts, rows] = await Promise.all([listAccounts(db), account ? listUncleared(db, account) : Promise.resolve([])]);
  const options = account && !accounts.includes(account) ? [account, ...accounts] : accounts;
  const nonce = crypto.randomUUID();

  return (
    <main className="mx-auto max-w-4xl space-y-4 px-4 py-6">
      <h1 className="text-xl font-semibold">Clear by bank account</h1>
      <form method="get" className="flex flex-wrap items-end gap-3">
        <div className="flex flex-col">
          <label htmlFor="clear-account" className="text-sm">Bank account</label>
          <select id="clear-account" name="account" defaultValue={account} className="rounded border px-2 py-1 text-sm">
            <option value="">— pick an account —</option>
            {options.map((a) => <option key={a} value={a}>{a}</option>)}
          </select>
        </div>
        <button className="rounded border px-3 py-1 text-sm">Show</button>
      </form>

      {clearError && <p role="alert" data-testid="clear-error" className="text-sm text-red-700">{clearingErrorMessage(clearError)}</p>}
      {!clearError && cleared != null && <p role="status" data-testid="clear-result" className="text-sm text-green-800">Cleared {cleared} row{cleared === 1 ? "" : "s"}.</p>}
      {!clearError && !!skipped && (
        <p role="alert" data-testid="clear-skipped" className="text-sm text-red-700">
          {skipped} selected row{skipped === 1 ? " was" : "s were"} not cleared — not on this account or already cleared.
        </p>
      )}
      {failed.map((f) => (
        <p key={f} role="alert" data-testid={`clear-failed-${f}`} className="text-sm text-red-700">
          The selected {f} rows were NOT cleared (database error){failed.length === 1 ? "; the other rows were saved" : ""}. Try again.
        </p>
      ))}

      {account && (
        // Keyed plain <form> per render so a same-URL redirect resets the checkboxes and inputs.
        <form key={nonce} action={clearRowsAction} aria-label="Mark cleared" className="space-y-3">
          <input type="hidden" name="account" value={account} />
          {rows.length === 0 && <p className="text-sm text-slate-600">No uncleared rows on {account}.</p>}
          {rows.length >= LIST_LIMIT && <p role="status" className="text-sm text-slate-600">Showing the first {LIST_LIMIT} of each kind.</p>}
          {rows.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left"><th className="p-1"><span className="sr-only">Select</span></th><th className="p-1">Date</th><th className="p-1">Kind</th><th className="p-1">Description / payee</th><th className="p-1 text-right">Amount</th></tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={`${r.kind}-${r.id}`} className="border-t">
                      <td className="p-1">
                        <input type="checkbox" name={r.kind === "Expense" ? "exp" : "fnd"} value={r.id}
                          aria-label={`Select ${r.kind} ${r.id} ${r.description}`} />
                      </td>
                      <td className="p-1">{r.date}</td>
                      <td className="p-1">{r.kind}</td>
                      <td className="p-1">{r.description}</td>
                      <td className="p-1 text-right">${Number(r.amount).toFixed(2)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <div className="flex flex-wrap items-end gap-3">
            <div className="flex flex-col">
              <label htmlFor="clear-date" className="text-sm">Cleared date</label>
              <input id="clear-date" name="date" type="date" required defaultValue={firmToday(new Date())} className="rounded border px-2 py-1 text-sm" />
            </div>
            <div className="flex flex-col">
              <label htmlFor="clear-note" className="text-sm">Clearing note (optional)</label>
              <input id="clear-note" name="note" className="w-64 rounded border px-2 py-1 text-sm" />
            </div>
            <button className="rounded bg-slate-800 px-3 py-1 text-sm text-white">Mark cleared</button>
            <span className="text-xs text-slate-600">Up to {MAX_SELECTED} rows at a time.</span>
          </div>
        </form>
      )}
    </main>
  );
}
