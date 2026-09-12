import { requireSession } from "@/lib/auth/session";
import { createServerClient } from "@/lib/db/client";
import { otherExperts, param } from "@/lib/cases/presets";
import { Back, CaseLink, ErrorNote, Table } from "../ui";

export const dynamic = "force-dynamic";

export default async function OtherExpertsPage({ searchParams }: { searchParams: Record<string, string | string[] | undefined> }) {
  await requireSession();
  const db = createServerClient();
  const q = param(searchParams.q).trim();
  const [result] = await Promise.all([otherExperts(db, q)]);
  return (
    <main className="mx-auto max-w-6xl space-y-4 px-4 py-6">
      <Back />
      <h1 className="text-xl font-semibold">Other experts</h1>
      <form method="get" className="flex flex-wrap gap-2" role="search">
        <label htmlFor="q" className="sr-only">Search other experts</label>
        <input id="q" name="q" defaultValue={q} placeholder="Expert name…" className="min-w-0 flex-1 rounded border border-slate-300 px-3 py-1.5 text-sm" />
        <button type="submit" className="rounded bg-slate-800 px-3 py-1.5 text-sm text-white hover:bg-slate-700">Search</button>
      </form>
      {"error" in result ? <ErrorNote message={result.error} />
        : !q ? <p className="text-sm text-slate-600">Enter part of an expert&apos;s name.</p>
        : !result.rows.length ? <p className="text-sm text-slate-600">No cases list an other expert matching &quot;{q}&quot;.</p>
        : <Table testId="other-experts" head={["Case #", "Title", "Other experts"]}
            rows={result.rows.map((r) => ({ key: r.caseid, cells: [<CaseLink key="id" id={r.caseid} />, r.casetitle, r.otherexperts] }))} />}
    </main>
  );
}
