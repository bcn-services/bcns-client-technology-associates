import { requireSession } from "@/lib/auth/session";
import { DEFAULT_ACCOUNT, importErrorMessage, resultLine } from "@/lib/bank-import/import";
import { importBankAction } from "./actions";

export const dynamic = "force-dynamic";

type Params = Record<string, string | string[] | undefined>;
const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
const count = (v: string) => (/^\d{1,9}$/.test(v) ? Number(v) : null);

/** Bank review: upload a BoA CSV export into bank_transactions. */
export default async function BankReviewPage({ searchParams }: { searchParams: Params }) {
  await requireSession();
  const importError = first(searchParams.importerror);
  const detail = first(searchParams.importdetail);
  const [imported, already, credits] = ["imported", "already", "credits"].map((k) => count(first(searchParams[k])));
  const done = !importError && imported != null && already != null && credits != null;
  const account = first(searchParams.account) || DEFAULT_ACCOUNT;
  return (
    <main className="mx-auto max-w-4xl space-y-4 px-4 py-6">
      <h1 className="text-xl font-semibold">Bank review</h1>
      {/* Key on a host element: a same-URL redirect otherwise keeps the old file/account inputs. */}
      <section aria-label="Import bank export" key={crypto.randomUUID()} className="space-y-2">
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
    </main>
  );
}
