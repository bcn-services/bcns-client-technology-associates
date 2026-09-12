import type { ReactNode } from "react";
import Link from "next/link";
import { requireSession } from "@/lib/auth/session";
import { createServerClient } from "@/lib/db/client";
import { loadCaseOptions, type Db, type Option } from "@/lib/cases/record";
import { newCaseDefaults, nextCaseId, returnWith } from "@/lib/cases/create";
import { NewCaseForm } from "./new-case-form";

export const dynamic = "force-dynamic";

type Params = Record<string, string | string[] | undefined>;
const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
const idParam = (v: string | string[] | undefined) => (/^\d{1,9}$/.test(first(v)) ? first(v) : "");
const input = "rounded border border-slate-300 px-2 py-1";

function Pick({ id, name, label, opts, value, required, extra }: { id: string; name: string; label: string; opts: Option[] | string[]; value: string; required?: boolean; extra?: ReactNode }) {
  const list = opts.map((o) => (typeof o === "string" ? { value: o, label: o } : o));
  return (
    <div className="grid gap-1 text-sm">
      <label htmlFor={id}>{label}</label>
      <select id={id} name={name} defaultValue={value} required={required} className={input}>
        <option value="" />
        {list.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
      {extra}
    </div>
  );
}

export default async function NewCasePage({ searchParams }: { searchParams: Params }) {
  await requireSession();
  const db = createServerClient() as unknown as Db;
  const [next, o] = await Promise.all([nextCaseId(db), loadCaseOptions(db)]);
  const d = newCaseDefaults(new Date());
  // The lookup's own spelling of "Open" (case-insensitive). If the lookup lacks it, no default: the status FK would refuse it.
  const status = o.status.find((s) => s.toLowerCase() === String(d.status).toLowerCase()) ?? "";
  const pre = { attorney: idParam(searchParams.attorney), client: idParam(searchParams.client), inquiry: idParam(searchParams.inquiry) };
  // "Add attorney/client" returns here with the new row selected and the other picks kept.
  const here = Object.entries(pre).reduce((u, [k, v]) => (v ? returnWith(u, k, v) : u), "/cases/new");
  const addLink = (path: string, text: string) => (
    <Link href={`${path}/new?returnTo=${encodeURIComponent(here)}`} className="text-sm underline">{text}</Link>
  );
  const text = (col: string, label: string, value = "", required = false) => (
    <label htmlFor={`f-${col}`} className="grid gap-1 text-sm">
      {label}
      <input id={`f-${col}`} name={col} defaultValue={value} required={required} className={input} />
    </label>
  );

  return (
    <main className="mx-auto max-w-4xl space-y-4 px-4 py-6">
      <p className="text-sm"><Link href="/cases" className="text-slate-600 underline">Case search</Link></p>
      <h1 className="text-xl font-semibold">New case</h1>
      <NewCaseForm>
        <section className="grid gap-3 sm:grid-cols-2">
          <label htmlFor="f-caseid" className="grid gap-1 text-sm">
            Case number
            <input id="f-caseid" name="caseid" inputMode="numeric" pattern="\d{1,9}" defaultValue={String(next)} required className={input} />
          </label>
          {text("casetitle", "Title", String(d.casetitle), true)}
          {text("casesubject", "Subject")}
          <label htmlFor="f-casestartdate" className="grid gap-1 text-sm">
            Start Date
            <input id="f-casestartdate" name="casestartdate" type="date" defaultValue={String(d.casestartdate)} required className={input} />
          </label>
          <label htmlFor="f-casecaption" className="grid gap-1 text-sm sm:col-span-2">
            Caption
            <textarea id="f-casecaption" name="casecaption" rows={3} className={input} />
          </label>
          <Pick id="f-status" name="status" label="Status" opts={o.status} value={status} required />
          <Pick id="f-tabranch" name="tabranch" label="Branch" opts={o.branch} value="" required />
          <Pick id="f-caseatty" name="caseatty" label="Attorney" opts={o.attorney} value={pre.attorney} required extra={addLink("/attorneys", "Add attorney")} />
          <Pick id="f-caseclient" name="caseclient" label="Client" opts={o.client} value={pre.client} required extra={addLink("/clients", "Add client")} />
          <Pick id="f-caseinquiry" name="caseinquiry" label="Inquiry (optional)" opts={o.inquiry} value={pre.inquiry} />
        </section>
      </NewCaseForm>
    </main>
  );
}
