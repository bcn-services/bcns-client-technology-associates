import Link from "next/link";
import { requireSession } from "@/lib/auth/session";
import { createServerClient } from "@/lib/db/client";
import { LIST_KINDS, listCases, quickSpec, runSearch, type ListKind } from "@/lib/cases/search";
import { ResultsTable } from "./results-table";

export const dynamic = "force-dynamic";

type Params = { q?: string; list?: string; page?: string };

export default async function CasesPage({ searchParams }: { searchParams: Params }) {
  await requireSession();
  const db = createServerClient();
  const q = (searchParams.q ?? "").trim();
  const spec = quickSpec(q);
  const kind: ListKind = LIST_KINDS.some((l) => l.kind === searchParams.list) ? (searchParams.list as ListKind) : "newest";
  const page = Math.max(0, Number.parseInt(searchParams.page ?? "0", 10) || 0);
  const [result] = await Promise.all([spec ? runSearch(db, spec) : listCases(db, kind, page)]);
  const more = !("error" in result) && result.more;

  return (
    <main className="mx-auto max-w-6xl space-y-4 px-4 py-6">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="text-xl font-semibold">Cases</h1>
        <Link href="/cases/search" className="text-sm text-blue-700 hover:underline">Advanced search</Link>
      </div>
      <form method="get" className="flex flex-wrap gap-2" role="search">
        <label htmlFor="q" className="sr-only">Search cases</label>
        <input id="q" name="q" defaultValue={q} placeholder="Case #, title, attorney, firm, client…" className="min-w-0 flex-1 rounded border border-slate-300 px-3 py-1.5 text-sm" />
        <button type="submit" className="rounded bg-slate-800 px-3 py-1.5 text-sm text-white hover:bg-slate-700">Search</button>
        {q && <Link href="/cases" className="px-2 py-1.5 text-sm text-slate-600 hover:underline">Clear</Link>}
      </form>
      {!spec && (
        <nav aria-label="Case lists" className="flex flex-wrap gap-1 text-sm">
          {LIST_KINDS.map((l) => (
            <Link key={l.kind} href={`/cases?list=${l.kind}`} aria-current={l.kind === kind ? "page" : undefined}
              className={`rounded px-2 py-1 ${l.kind === kind ? "bg-slate-800 text-white" : "text-slate-700 hover:bg-slate-100"}`}>
              {l.label}
            </Link>
          ))}
        </nav>
      )}
      <ResultsTable result={result} titlesOnly={!spec && kind === "titles"} empty={spec ? `No cases match "${q}".` : "No cases yet."} />
      {!spec && (page > 0 || more) && (
        <div className="flex gap-3 text-sm">
          {page > 0 && <Link href={`/cases?list=${kind}&page=${page - 1}`} className="text-blue-700 hover:underline">Previous</Link>}
          {more && <Link href={`/cases?list=${kind}&page=${page + 1}`} className="text-blue-700 hover:underline">Next</Link>}
        </div>
      )}
    </main>
  );
}
