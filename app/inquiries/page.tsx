import Link from "next/link";
import { requireSession } from "@/lib/auth/session";
import { createServerClient } from "@/lib/db/client";
import {
  advancedSearch, byAttorneyName, byHowHeard, quickSearch, recentInquiries,
  type AdvancedParams, type DateMode, type InquiryListRow,
} from "@/lib/inquiries/inquiries";

export const dynamic = "force-dynamic";

type Params = Record<string, string | undefined>;
const input = "rounded border border-slate-300 px-2 py-1";
const button = "rounded border border-slate-300 px-3 py-1 hover:bg-slate-100";
const DATE_MODES: DateMode[] = ["between", "onOrAfter", "onOrBefore"];

export default async function InquiriesPage({ searchParams: sp }: { searchParams: Params }) {
  await requireSession();
  const db = createServerClient();
  const s = (k: string) => (sp[k] ?? "").trim();

  let title = "Recent inquiries";
  let rows: InquiryListRow[];
  if (sp.mode === "advanced") {
    title = "Advanced search";
    const dateMode = DATE_MODES.find((m) => m === sp.dateMode);
    const p: AdvancedParams = {
      attyname: s("attyname"), subject: s("subject"), location: s("location"), branch: s("branch"),
      referredby: s("referredby"), resultingcase: s("resultingcase"), dateMode, date1: s("date1"), date2: s("date2"),
    };
    rows = await advancedSearch(db, p);
  } else if (sp.mode === "attorney" && s("name")) {
    title = `Inquiries by attorney “${s("name")}”`;
    rows = await byAttorneyName(db, s("name"));
  } else if (sp.mode === "howheard" && s("source")) {
    title = `How heard about us: “${s("source")}”`;
    rows = await byHowHeard(db, s("source"));
  } else if (s("q")) {
    title = `Search: “${s("q")}”`;
    rows = await quickSearch(db, s("q"));
  } else {
    rows = await recentInquiries(db);
  }

  return (
    <main className="mx-auto max-w-6xl space-y-6 px-4 py-6">
      <div className="flex items-baseline justify-between">
        <h1 className="text-xl font-semibold">Inquiries</h1>
        <Link href="/inquiries/new" className={button}>New inquiry</Link>
      </div>

      <form method="get" className="flex flex-wrap items-end gap-2">
        <label className="grid gap-1 text-sm">
          Quick search
          <input name="q" defaultValue={s("q")} className={input} />
        </label>
        <button type="submit" className={button}>Search</button>
      </form>

      <details open={sp.mode === "advanced"} className="rounded border border-slate-200 p-3">
        <summary className="cursor-pointer text-sm font-medium">Advanced search</summary>
        <form method="get" className="mt-3 grid gap-3 sm:grid-cols-3">
          <input type="hidden" name="mode" value="advanced" />
          {([["attyname", "Attorney name"], ["subject", "Subject contains"], ["location", "Location"], ["branch", "Branch"], ["referredby", "Referred by"], ["resultingcase", "Resulting case"]] as const).map(([n, l]) => (
            <label key={n} className="grid gap-1 text-sm">
              {l}
              <input name={n} defaultValue={sp.mode === "advanced" ? s(n) : ""} className={input} />
            </label>
          ))}
          <label className="grid gap-1 text-sm">
            Date
            <select name="dateMode" defaultValue={sp.dateMode ?? ""} className={input}>
              <option value="">Any date</option>
              <option value="between">Between</option>
              <option value="onOrAfter">On or after</option>
              <option value="onOrBefore">On or before</option>
            </select>
          </label>
          <label className="grid gap-1 text-sm">
            From / on
            <input type="date" name="date1" defaultValue={s("date1")} className={input} />
          </label>
          <label className="grid gap-1 text-sm">
            To (between only)
            <input type="date" name="date2" defaultValue={s("date2")} className={input} />
          </label>
          <div><button type="submit" className={button}>Run advanced search</button></div>
        </form>
      </details>

      <div className="flex flex-wrap gap-6">
        <form method="get" className="flex items-end gap-2">
          <input type="hidden" name="mode" value="attorney" />
          <label className="grid gap-1 text-sm">
            Inquiries by attorney name
            <input name="name" defaultValue={sp.mode === "attorney" ? s("name") : ""} className={input} />
          </label>
          <button type="submit" className={button}>Find</button>
        </form>
        <form method="get" className="flex items-end gap-2">
          <input type="hidden" name="mode" value="howheard" />
          <label className="grid gap-1 text-sm">
            How heard about us (source)
            <input name="source" defaultValue={sp.mode === "howheard" ? s("source") : ""} className={input} />
          </label>
          <button type="submit" className={button}>Find</button>
        </form>
      </div>

      <section className="space-y-2">
        <h2 className="text-sm font-medium text-slate-600">{title} ({rows.length})</h2>
        <table className="w-full text-left text-sm">
          <thead className="border-b border-slate-200 text-slate-600">
            <tr>
              <th className="py-2">ID</th><th className="py-2">Date</th><th className="py-2">Caller</th>
              <th className="py-2">Attorney</th><th className="py-2">Firm</th><th className="py-2">Subject</th>
              <th className="py-2">Branch</th><th className="py-2">How heard</th><th className="py-2">Case</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} data-inquiry-id={r.id} className="border-b border-slate-100 align-top">
                <td className="py-2"><Link href={`/inquiries/${r.id}`} className="underline">{r.id}</Link></td>
                <td className="py-2">{r.inqdate}</td>
                <td className="py-2">{r.inqcallername}</td>
                <td className="py-2">{r.inqattyname}</td>
                <td className="py-2">{r.inqfirm}</td>
                <td className="py-2">{r.inqsubject}</td>
                <td className="py-2">{r.tabranch}</td>
                <td className="py-2">{r.inqhowheardaboutus}</td>
                <td className="py-2">{r.inqresultingcase ?? ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </main>
  );
}
