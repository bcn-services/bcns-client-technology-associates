import Link from "next/link";
import { requireSession } from "@/lib/auth/session";
import { createServerClient } from "@/lib/db/client";
import { ADVANCED_FIELDS, advancedSpec, runSearch } from "@/lib/cases/search";
import { ResultsTable } from "../results-table";

export const dynamic = "force-dynamic";

type Params = Record<string, string | undefined>;

export default async function AdvancedSearchPage({ searchParams }: { searchParams: Params }) {
  await requireSession();
  const db = createServerClient();
  const submitted = searchParams.go !== undefined;
  const [{ data: statuses, error: statusError }] = await Promise.all([
    db.from("tblcasestatus").select("casestatus").order("casestatus"),
  ]);
  if (statusError) console.error(`/cases/search: tblcasestatus read failed: ${statusError.message}`);
  const parsed = submitted ? advancedSpec(searchParams) : null;
  const result = parsed && "spec" in parsed ? await runSearch(db, parsed.spec) : null;
  const input = "min-w-0 flex-1 rounded border border-slate-300 px-2 py-1 text-sm";

  return (
    <main className="mx-auto max-w-6xl space-y-4 px-4 py-6">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="text-xl font-semibold">Advanced case search</h1>
        <Link href="/cases" className="text-sm text-blue-700 hover:underline">Quick search</Link>
      </div>
      <form method="get" className="space-y-3">
        <input type="hidden" name="go" value="1" />
        <fieldset className="grid gap-2 sm:grid-cols-2">
          <legend className="mb-1 text-sm text-slate-600">Tick each field to search on</legend>
          {ADVANCED_FIELDS.map((f) => (
            <div key={f.key} className="flex items-center gap-2">
              <input type="checkbox" id={`use_${f.key}`} name={`use_${f.key}`} value="1" defaultChecked={!!searchParams[`use_${f.key}`]} />
              <label htmlFor={`use_${f.key}`} className="w-32 shrink-0 text-sm">{f.label}</label>
              {f.kind === "exact" ? (
                <select name={f.key} aria-label={f.label} defaultValue={searchParams[f.key] ?? ""} className={input}>
                  <option value="" />
                  {(statuses ?? []).map((s) => <option key={s.casestatus} value={s.casestatus}>{s.casestatus}</option>)}
                </select>
              ) : (
                <input name={f.key} aria-label={f.label} type={f.kind === "date" ? "date" : "text"}
                  inputMode={f.kind === "number" ? "numeric" : undefined} defaultValue={searchParams[f.key] ?? ""} className={input} />
              )}
            </div>
          ))}
        </fieldset>
        <fieldset className="flex gap-4 text-sm">
          <legend className="sr-only">Match</legend>
          <label className="flex items-center gap-1">
            <input type="radio" name="mode" value="and" defaultChecked={searchParams.mode !== "or"} /> Match all (AND)
          </label>
          <label className="flex items-center gap-1">
            <input type="radio" name="mode" value="or" defaultChecked={searchParams.mode === "or"} /> Match any (OR)
          </label>
        </fieldset>
        <button type="submit" className="rounded bg-slate-800 px-3 py-1.5 text-sm text-white hover:bg-slate-700">Search</button>
      </form>
      {parsed && "message" in parsed && <p role="alert" className="text-sm text-red-700">{parsed.message}</p>}
      {result && <ResultsTable result={result} empty="No cases match." />}
    </main>
  );
}
