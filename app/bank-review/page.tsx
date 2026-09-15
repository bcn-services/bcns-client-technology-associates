import { requireSession } from "@/lib/auth/session";
import { createServerClient } from "@/lib/db/client";
import type { Db } from "@/lib/time/entries";
import { DEFAULT_ACCOUNT, importErrorMessage, resultLine } from "@/lib/bank-import/import";
import { INBOX_LIMIT, confirmErrorMessage, listInbox, listPastTypes } from "@/lib/bank-import/confirm";
import { buildTypeIndex, suggestFromIndex } from "@/lib/bank-import/suggest";
import { listActiveTypes } from "@/lib/expenses/types";
import { confirmTransactionAction, importBankAction } from "./actions";

export const dynamic = "force-dynamic";

type Params = Record<string, string | string[] | undefined>;
const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
const count = (v: string) => (/^\d{1,9}$/.test(v) ? Number(v) : null);
const usd = (v: number | string) => String(v).replace(/^-/, "");

/** Bank review: upload a BoA CSV export into bank_transactions, then confirm each into a cleared expense. */
export default async function BankReviewPage({ searchParams }: { searchParams: Params }) {
  await requireSession();
  const importError = first(searchParams.importerror);
  const detail = first(searchParams.importdetail);
  const [imported, already, credits] = ["imported", "already", "credits"].map((k) => count(first(searchParams[k])));
  const done = !importError && imported != null && already != null && credits != null;
  const account = first(searchParams.account) || DEFAULT_ACCOUNT;
  const confirmError = first(searchParams.confirmerror);
  const confirmTx = count(first(searchParams.confirmtx));
  const cleared = count(first(searchParams.cleared));

  const db = createServerClient() as unknown as Db;
  const [inbox, types, past] = await Promise.all([listInbox(db), listActiveTypes(db), listPastTypes(db)]);
  const typeIndex = buildTypeIndex(past, new Set(types.map((t) => t.exptypeid)));
  // A refusal for a tx no longer in the inbox (double-click loser, deleted) shows at the top, not on a missing row.
  const confirmTxShown = confirmTx != null && inbox.some((t) => t.id === confirmTx);
  const nonce = crypto.randomUUID();

  return (
    <main className="mx-auto max-w-4xl space-y-4 px-4 py-6">
      <h1 className="text-xl font-semibold">Bank review</h1>
      <p className="text-sm"><a href="/bank-review/accounts" className="underline">Clear by bank account</a></p>
      {/* Key on a host element: a same-URL redirect otherwise keeps the old file/account inputs. */}
      <section aria-label="Import bank export" key={`import-${nonce}`} className="space-y-2">
        <h2 className="font-semibold">Import bank export</h2>
        {importError && (
          <p role="alert" data-testid="import-error" className="text-sm text-red-700">
            {importErrorMessage(importError)}{detail && `: ${detail}`}
          </p>
        )}
        {done && <p role="status" data-testid="import-result" className="text-sm text-green-800">{resultLine({ imported, already, credits })}</p>}
        <form action={importBankAction} className="flex flex-wrap items-end gap-3">
          <div className="flex flex-col">
            <label htmlFor="import-account" className="text-sm">Account</label>
            <input id="import-account" name="account" defaultValue={account} required className="rounded border px-2 py-1 text-sm" />
          </div>
          <div className="flex flex-col">
            <label htmlFor="import-file" className="text-sm">Upload CSV</label>
            <input id="import-file" name="file" type="file" accept=".csv,text/csv" required className="text-sm" />
          </div>
          <button className="rounded bg-slate-800 px-3 py-1 text-sm text-white">Import</button>
        </form>
      </section>

      <section aria-label="Transactions to review" className="space-y-2">
        <h2 className="font-semibold">Transactions to review</h2>
        {cleared != null && !confirmError && <p role="status" data-testid="confirm-result" className="text-sm text-green-800">Cleared — expense #{cleared}</p>}
        {confirmError && !confirmTxShown && <p role="alert" data-testid="confirm-error" className="text-sm text-red-700">{confirmErrorMessage(confirmError)}</p>}
        {inbox.length === 0 && <p className="text-sm text-slate-600">Nothing to review.</p>}
        {inbox.length >= INBOX_LIMIT && <p role="status" className="text-sm text-slate-600">Showing oldest {INBOX_LIMIT}.</p>}
        {inbox.map((t) => {
          const suggested = suggestFromIndex(t.description, typeIndex);
          const id = (f: string) => `${f}-${t.id}`;
          return (
            // Keyed plain <form> per render so a same-URL redirect resets its inputs to the prefills.
            <form key={`${t.id}-${nonce}`} action={confirmTransactionAction} aria-label={`Review ${t.description} ${t.postedon}`}
              className="flex flex-wrap items-end gap-3 rounded border p-2">
              <input type="hidden" name="tx" value={t.id} />
              <div className="w-40 text-sm">
                <div>{t.postedon} · ${usd(t.amount)}</div>
                <div className="text-slate-600">{t.bankaccount}</div>
              </div>
              <div className="flex flex-col">
                <label htmlFor={id("case")} className="text-sm">Case (optional)</label>
                <input id={id("case")} name="case" inputMode="numeric" className="w-24 rounded border px-2 py-1 text-sm" />
              </div>
              <div className="flex flex-col">
                <label htmlFor={id("type")} className="text-sm">Expense type</label>
                <select id={id("type")} name="type" defaultValue={suggested ?? ""} className="rounded border px-2 py-1 text-sm">
                  <option value="">— pick a type —</option>
                  {types.map((ty) => <option key={ty.exptypeid} value={ty.exptypeid}>{ty.exptype}</option>)}
                </select>
              </div>
              <div className="flex flex-col">
                <label htmlFor={id("dscr")} className="text-sm">Description</label>
                <input id={id("dscr")} name="dscr" defaultValue={t.description} required className="w-64 rounded border px-2 py-1 text-sm" />
              </div>
              <button className="rounded bg-slate-800 px-3 py-1 text-sm text-white">Confirm</button>
              {confirmError && confirmTx === t.id && (
                <p role="alert" data-testid="confirm-error" className="w-full text-sm text-red-700">{confirmErrorMessage(confirmError)}</p>
              )}
            </form>
          );
        })}
      </section>
    </main>
  );
}
