import Link from "next/link";
import { createServerClient } from "@/lib/db/client";
import { onlyForbidden } from "@/lib/auth/users";
import type { Db } from "@/lib/time/entries";
import { NO_ACTOR, actorName, changedFields, parseFilters, runAuditList, type AuditRow } from "@/lib/audit/list";

export const dynamic = "force-dynamic";

type Params = Record<string, string | string[] | undefined>;

const input = "rounded border border-slate-300 px-2 py-1 text-sm";

function show(v: unknown): string {
  const s = typeof v === "string" ? v : JSON.stringify(v);
  return s.length > 200 ? `${s.slice(0, 200)}…` : s;
}

function Changes({ row }: { row: AuditRow }) {
  if (row.op === "UPDATE") {
    const rows = changedFields(row.olddata, row.newdata);
    if (rows.length === 0) return <span className="text-slate-500">no field changed</span>;
    return (
      <ul className="space-y-0.5">
        {rows.map((c) => (
          <li key={c.field}>
            <span className="font-medium">{c.field}</span>: <span className="text-red-700">{c.from === null ? "null" : show(c.from)}</span>
            {" → "}<span className="text-emerald-700">{c.to === null ? "null" : show(c.to)}</span>
          </li>
        ))}
      </ul>
    );
  }
  // INSERT / DELETE: the whole row is the change; keep it one click away instead of a wall of JSON.
  return (
    <details>
      <summary className="cursor-pointer text-slate-600">{row.op === "INSERT" ? "row created" : "row deleted"}</summary>
      <pre className="mt-1 max-w-xl overflow-x-auto whitespace-pre-wrap text-xs">{JSON.stringify(row.op === "INSERT" ? row.newdata : row.olddata, null, 1)}</pre>
    </details>
  );
}

/** Recent changes to any table, newest first. Admin only; read-only. */
export default async function AuditPage({ searchParams }: { searchParams: Params }) {
  // Admin check before any audit_log query — staff get a plain refusal (same shape as /users).
  const page = await runAuditList({ db: createServerClient() as unknown as Db, params: searchParams }).catch(onlyForbidden);
  if (!page) {
    return (
      <main className="mx-auto max-w-6xl space-y-2 px-4 py-6">
        <h1 className="text-xl font-semibold">Audit log</h1>
        <p role="alert" className="text-sm text-red-700">Admins only.</p>
      </main>
    );
  }
  const f = parseFilters(searchParams);
  const { rows, nextBefore, actors } = page;
  const keep = new URLSearchParams();
  for (const [k, v] of Object.entries({ table: f.table, rowid: f.rowid, actor: f.actor, from: f.from, to: f.to })) if (v) keep.set(k, v);
  const filtered = keep.size > 0;
  const olderQs = new URLSearchParams(keep);
  if (nextBefore) olderQs.set("before", String(nextBefore));

  return (
    <main className="mx-auto max-w-6xl space-y-4 px-4 py-6">
      <h1 className="text-xl font-semibold">Audit log</h1>
      <form method="get" className="flex flex-wrap items-end gap-2" role="search">
        <label className="text-xs text-slate-600">Table<br /><input name="table" defaultValue={f.table ?? ""} placeholder="tblcase" className={input} /></label>
        <label className="text-xs text-slate-600">Row id<br /><input name="rowid" defaultValue={f.rowid ?? ""} className={`${input} w-28`} /></label>
        <label className="text-xs text-slate-600">Person<br />
          <select name="actor" defaultValue={f.actor ?? ""} className={input}>
            <option value="">Anyone</option>
            <option value={NO_ACTOR}>system / unknown</option>
            {[...actors.values()].map((a) => <option key={a.id} value={a.id}>{actorName(a.id, actors)}</option>)}
          </select>
        </label>
        <label className="text-xs text-slate-600">From<br /><input type="date" name="from" defaultValue={f.from ?? ""} className={input} /></label>
        <label className="text-xs text-slate-600">To<br /><input type="date" name="to" defaultValue={f.to ?? ""} className={input} /></label>
        <button type="submit" className="rounded bg-slate-800 px-3 py-1.5 text-sm text-white hover:bg-slate-700">Filter</button>
        {filtered && <Link href="/audit" className="px-2 py-1.5 text-sm text-slate-600 hover:underline">Clear</Link>}
      </form>
      {rows.length === 0 ? (
        <p className="text-sm text-slate-700">{f.before ? "No older changes." : "No changes match."}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b text-slate-700">
                <th className="py-1 pr-3">When (UTC)</th><th className="py-1 pr-3">Who</th><th className="py-1 pr-3">Table</th>
                <th className="py-1 pr-3">Row</th><th className="py-1 pr-3">Op</th><th className="py-1">Changes</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-b align-top" data-audit-id={r.id}>
                  <td className="whitespace-nowrap py-1 pr-3">{r.at.slice(0, 19).replace("T", " ")}</td>
                  <td className="py-1 pr-3">{actorName(r.actor, actors)}</td>
                  <td className="py-1 pr-3">{r.tablename}</td>
                  <td className="py-1 pr-3">{r.rowid}</td>
                  <td className="py-1 pr-3">{r.op}</td>
                  <td className="py-1"><Changes row={r} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="flex gap-3 text-sm">
        {f.before && <Link href={filtered ? `/audit?${keep}` : "/audit"} className="text-blue-700 hover:underline">Newest</Link>}
        {nextBefore && <Link href={`/audit?${olderQs}`} className="text-blue-700 hover:underline">Older</Link>}
      </div>
    </main>
  );
}
