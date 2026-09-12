import Link from "next/link";
import { notFound } from "next/navigation";
import { requireSession } from "@/lib/auth/session";
import { createServerClient } from "@/lib/db/client";
import {
  EVENT_SUGGESTIONS, errorMessage, field, attorneyName, clientName, firmAddress, formValue, origValue, loadCaseOptions, loadCaseRecord,
  type CaseOptions, type Db, type Field, type Option, type Row,
} from "@/lib/cases/record";
import { saveCaseAction } from "./actions";
import { LockedForm } from "./locked-form";
import { ServiceAuthsPanel } from "./service-auths";
import { loadServiceAuths } from "@/lib/cases/service-auths";
import { firmToday } from "@/lib/cases/presets";

export const dynamic = "force-dynamic";

type Params = Record<string, string | string[] | undefined>;
const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
const input = "rounded border border-slate-300 px-2 py-1 disabled:bg-slate-50";
const eqi = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

/** Lookup values, keeping a stored value that is off-list (or differs only in case) so an untouched save writes nothing. */
function textOptions(list: string[], cur: string): Option[] {
  const out = list.map((o) => ({ value: cur && eqi(o, cur) ? cur : o, label: cur && eqi(o, cur) ? cur : o }));
  return cur && !out.some((o) => o.value === cur) ? [{ value: cur, label: cur }, ...out] : out;
}
function idOptions(list: Option[], cur: string): Option[] {
  return cur && !list.some((o) => o.value === cur) ? [{ value: cur, label: `(missing #${cur})` }, ...list] : list;
}

/** The input plus a hidden `<col>__orig` holding the value it was rendered with; the save diffs against that. */
function Control(p: { f: Field; row: Row; o: CaseOptions; labelledBy?: string }) {
  return (
    <>
      <Input {...p} />
      <input type="hidden" name={`${p.f.col}__orig`} defaultValue={origValue(p.f, p.row)} />
    </>
  );
}

function Input({ f, row, o, labelledBy }: { f: Field; row: Row; o: CaseOptions; labelledBy?: string }) {
  const id = `f-${f.col}`;
  const v = formValue(f, row);
  const common = { id, name: f.col, className: input };
  switch (f.control) {
    case "textarea": return <textarea {...common} defaultValue={v} rows={3} />;
    case "date": return <input {...common} type="date" defaultValue={v} required={f.required} />;
    case "int": return <input {...common} inputMode="numeric" defaultValue={v} />;
    case "eventdesc": return <input {...common} list="event-desc" defaultValue={v} />;
    case "bool":
      return (
        <>
          <input type="hidden" name={`${f.col}__present`} value="1" />
          <input id={id} name={f.col} type="checkbox" defaultChecked={row[f.col] === true} />
        </>
      );
    case "status": case "branch": case "priority": case "waitingfor": case "pointman":
    case "attorney": case "client": case "inquiry": {
      const opts = ["attorney", "client", "inquiry"].includes(f.control)
        ? idOptions(o[f.control as "attorney" | "client" | "inquiry"], v)
        : textOptions(o[f.control as "status" | "branch" | "priority" | "waitingfor" | "pointman"], v);
      return (
        <select {...common} defaultValue={v} required={f.required} aria-labelledby={labelledBy}>
          <option value="" />
          {opts.map((op) => <option key={op.value} value={op.value}>{op.label}</option>)}
        </select>
      );
    }
    default: return <input {...common} defaultValue={v} required={f.required} />;
  }
}

function Labeled({ col, row, o, wide }: { col: string; row: Row; o: CaseOptions; wide?: boolean }) {
  const f = field(col);
  if (f.kind === "bool") {
    return <label htmlFor={`f-${col}`} className="flex items-center gap-2 text-sm"><Control f={f} row={row} o={o} /> {f.label}</label>;
  }
  return (
    <label htmlFor={`f-${col}`} className={`grid gap-1 text-sm ${wide ? "sm:col-span-2" : ""}`}>
      {f.label}
      <Control f={f} row={row} o={o} />
    </label>
  );
}

const Detail = ({ label, value }: { label: string; value: unknown }) => (
  <div className="text-sm"><span className="text-slate-500">{label}: </span>{value == null ? "" : String(value)}</div>
);

function Slot({ title }: { title: string }) {
  return (
    <section className="space-y-1 rounded border border-dashed border-slate-300 p-3">
      <h2 className="font-semibold">{title}</h2>
      <p className="text-sm text-slate-500">Not available yet.</p>
    </section>
  );
}

export default async function CaseRecordPage({ params, searchParams }: { params: { id: string }; searchParams: Params }) {
  await requireSession();
  if (!/^\d{1,9}$/.test(params.id)) notFound();
  const id = Number(params.id);
  const db = createServerClient() as unknown as Db;
  // A failed service-auth read shows a note in the panel; the case record still loads.
  const [rec, o, sas] = await Promise.all([loadCaseRecord(db, id), loadCaseOptions(db),
    loadServiceAuths(db, id).catch((e) => { console.error("service auths read:", e); return null; })]);
  if (!rec) notFound();
  const { kase, atty, firm, client } = rec;
  const saved = first(searchParams.saved);
  const error = first(searchParams.error);
  const lastChange = kase.casestatlastupdated ? new Date(String(kase.casestatlastupdated)).toLocaleString("en-US", { timeZone: "America/New_York" }) : "";
  const nav = "rounded border border-slate-300 px-3 py-1 text-sm hover:bg-slate-100";

  return (
    <main className="mx-auto max-w-6xl space-y-4 px-4 py-6">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <Link href="/cases" className="text-slate-600 underline">Case search</Link>
        {rec.prev != null ? <Link href={`/cases/${rec.prev}`} className={nav}>Previous case</Link> : <span className={`${nav} text-slate-400`}>Previous case</span>}
        {rec.next != null ? <Link href={`/cases/${rec.next}`} className={nav}>Next case</Link> : <span className={`${nav} text-slate-400`}>Next case</span>}
        <Link href={`/cases/${id}/label`} className="underline">Mailing label</Link>
        <Link href={`/cases/${id}/rolodex`} className="underline">Rolodex card</Link>
      </div>
      <h1 className="text-xl font-semibold">Case {id}: {String(kase.casetitle ?? "")}</h1>
      {rec.badges.length > 0 && (
        <ul aria-label="Alerts" className="flex flex-wrap gap-2">
          {rec.badges.map((b) => <li key={b} data-testid="case-badge" className="rounded bg-amber-100 px-2 py-0.5 text-sm font-medium text-amber-900">{b}</li>)}
        </ul>
      )}
      {saved && <p role="status" className="text-sm text-emerald-700">{saved === "1" ? "Case saved" : "No changes to save"}</p>}
      {error && <p role="alert" className="text-sm text-red-700">{errorMessage(error)}</p>}

      <LockedForm key={first(searchParams.t) ?? "initial"} action={saveCaseAction.bind(null, id)}>
        <div className="grid gap-4 md:grid-cols-3">
          <section className="space-y-1 rounded border border-slate-200 p-3">
            <h2 className="font-semibold">Firm</h2>
            <div className="text-sm font-medium">{String(firm?.frmname ?? "")}</div>
            <address className="whitespace-pre-line text-sm not-italic">{firmAddress(firm).join("\n")}</address>
            <Detail label="Phone" value={firm?.frmphone} />
            <Detail label="Fax" value={firm?.frmfax} />
          </section>
          <section className="space-y-1 rounded border border-slate-200 p-3">
            <h2 id="attorney-h" className="font-semibold">Attorney</h2>
            <Control f={field("caseatty")} row={kase} o={o} labelledBy="attorney-h" />
            <div className="text-sm font-medium">{attorneyName(atty)}</div>
            <Detail label="Email" value={atty?.attyemail} />
            <Detail label="Phone" value={atty?.attyphone} />
            <Detail label="Cell" value={atty?.attycellphone} />
          </section>
          <section className="space-y-1 rounded border border-slate-200 p-3">
            <h2 id="client-h" className="font-semibold">Client</h2>
            <Control f={field("caseclient")} row={kase} o={o} labelledBy="client-h" />
            <div className="text-sm font-medium">{clientName(client)}</div>
          </section>
        </div>

        <section className="grid gap-3 sm:grid-cols-2">
          <Labeled col="casetitle" row={kase} o={o} />
          <Labeled col="casesubject" row={kase} o={o} />
          <Labeled col="casecaption" row={kase} o={o} />
          <Labeled col="casenotes" row={kase} o={o} />
          <Labeled col="casestartdate" row={kase} o={o} />
          <Labeled col="caseenddate" row={kase} o={o} />
          <Labeled col="tabranch" row={kase} o={o} />
          <div className="grid gap-1">
            <Labeled col="caseinquiry" row={kase} o={o} />
            {kase.caseinquiry != null && <a href={`/inquiries/${kase.caseinquiry}`} className="text-sm underline">Open inquiry #{String(kase.caseinquiry)}</a>}
          </div>
          <Labeled col="otherexperts" row={kase} o={o} />
          <Labeled col="billingcc" row={kase} o={o} />
          <Labeled col="billingalert" row={kase} o={o} />
        </section>

        <section className="space-y-3 rounded border border-slate-200 p-3">
          <h2 className="font-semibold">Status</h2>
          <div className="grid gap-3 sm:grid-cols-3">
            <Labeled col="status" row={kase} o={o} />
            <Labeled col="casestatpriority" row={kase} o={o} />
            <Labeled col="casestatsubpriority" row={kase} o={o} />
            <Labeled col="casestatwaitingfor" row={kase} o={o} />
            <Labeled col="casestatpointman" row={kase} o={o} />
            <Labeled col="casestatduedate" row={kase} o={o} />
            <Labeled col="casestatduedatedescription" row={kase} o={o} />
            <Labeled col="casestatdescription" row={kase} o={o} wide />
          </div>
          <datalist id="event-desc">{EVENT_SUGGESTIONS.map((s) => <option key={s} value={s} />)}</datalist>
          <Detail label="Last change" value={lastChange} />
        </section>
      </LockedForm>

      {/* Headed slots for later lanes. */}
      <div className="grid gap-4 md:grid-cols-2">
        <ServiceAuthsPanel t={first(searchParams.t) ?? "initial"} caseId={id} rows={sas} today={firmToday(new Date())} saved={first(searchParams.sa)} error={first(searchParams.sa_error)} />
        <Slot title="Bills" />
        <Slot title="Funds received" />
        <Slot title="Expenses" />
      </div>
    </main>
  );
}
