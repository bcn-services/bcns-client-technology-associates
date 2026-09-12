import Link from "next/link";
import { requireSession } from "@/lib/auth/session";
import { createServerClient } from "@/lib/db/client";
import type { Db } from "@/lib/contacts/contacts";
import { PRESETS, runPreset, type PresetName } from "@/lib/contacts/presets";

export const dynamic = "force-dynamic";

export default async function ContactListsPage({ searchParams }: { searchParams: { preset?: string; value?: string } }) {
  await requireSession();
  const name = (searchParams.preset && searchParams.preset in PRESETS ? searchParams.preset : null) as PresetName | null;
  const preset = name ? PRESETS[name] : null;
  const value = searchParams.value ?? "";
  const ready = preset && (!preset.param || value !== "");
  const rows = ready ? await runPreset(createServerClient() as unknown as Db, name!, value) : [];

  return (
    <main className="mx-auto max-w-6xl space-y-4 px-4 py-6">
      <h1 className="text-xl font-semibold">Contact lists</h1>
      <nav aria-label="Contact lists" className="flex flex-wrap gap-3 text-sm">
        {Object.values(PRESETS).map((p) => (
          <Link key={p.name} href={`/attorneys/lists?preset=${p.name}`} className={p.name === name ? "font-semibold underline" : "underline"}>{p.title}</Link>
        ))}
      </nav>
      {preset?.param && (
        <form className="flex items-end gap-2 text-sm">
          <input type="hidden" name="preset" value={preset.name} />
          <label htmlFor="preset-value" className="grid gap-1">
            {preset.param}
            <input id="preset-value" name="value" defaultValue={value} required className="rounded border border-slate-300 px-2 py-1" />
          </label>
          <button type="submit" className="rounded border border-slate-300 px-3 py-1 hover:bg-slate-100">Show</button>
        </form>
      )}
      {ready && preset && (
        <>
          <h2 className="font-semibold">{preset.title} — {rows.length} rows</h2>
          <table className="w-full text-left text-sm">
            <thead className="border-b border-slate-200 text-slate-600">
              <tr>{preset.cols.map((c) => <th key={c.key} className="py-2">{c.label}</th>)}</tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i} className="border-b border-slate-100">
                  {preset.cols.map((c) => <td key={c.key} className="py-1">{typeof r[c.key] === "boolean" ? (r[c.key] ? "Yes" : "") : String(r[c.key] ?? "")}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </main>
  );
}
