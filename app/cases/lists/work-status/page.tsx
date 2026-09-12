import Link from "next/link";
import { requireSession } from "@/lib/auth/session";
import { createServerClient } from "@/lib/db/client";
import { POINT_MEN, workStatus, type WorkStatusSort } from "@/lib/cases/presets";
import { Back, ErrorNote } from "../ui";
import { WorkStatusTable, readParams } from "./table";

export const dynamic = "force-dynamic";

type Params = Record<string, string | string[] | undefined>;

export default async function WorkStatusPage({ searchParams }: { searchParams: Params }) {
  await requireSession();
  const db = createServerClient();
  const { pm, sort } = readParams(searchParams);
  const [result] = await Promise.all([workStatus(db, pm, sort)]);
  const qs = (s: WorkStatusSort) => `?${new URLSearchParams({ ...(pm && { pm }), sort: s })}`;

  return (
    <main className="mx-auto max-w-6xl space-y-4 px-4 py-6">
      <Back />
      <h1 className="text-xl font-semibold">Work Status</h1>
      <form method="get" className="flex flex-wrap items-end gap-3 text-sm">
        <label className="flex flex-col gap-1">
          Point man
          <select name="pm" defaultValue={pm} className="rounded border border-slate-300 px-2 py-1.5">
            <option value="">All</option>
            {POINT_MEN.map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
        </label>
        <input type="hidden" name="sort" value={sort} />
        <button type="submit" className="rounded bg-slate-800 px-3 py-1.5 text-white hover:bg-slate-700">Show</button>
      </form>
      <nav aria-label="Sort" className="flex flex-wrap gap-1 text-sm">
        {(["due", "priority"] as const).map((s) => (
          <Link key={s} href={qs(s)} aria-current={s === sort ? "page" : undefined}
            className={`rounded px-2 py-1 ${s === sort ? "bg-slate-800 text-white" : "text-slate-700 hover:bg-slate-100"}`}>
            {s === "due" ? "Due date first" : "By priority"}
          </Link>
        ))}
        <Link href={`/cases/lists/work-status/print${qs(sort)}`} className="ml-auto px-2 py-1 text-blue-700 hover:underline">Print sheet</Link>
      </nav>
      {"error" in result ? <ErrorNote message={result.error} /> : <WorkStatusTable rows={result.rows} />}
    </main>
  );
}
