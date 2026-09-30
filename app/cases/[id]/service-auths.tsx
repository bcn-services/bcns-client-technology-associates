import Link from "next/link";
import type { Row } from "@/lib/cases/record";
import { SA_FIELDS, SA_STATUSES, isAppSaFile, saErrorMessage, saValue, type SaField } from "@/lib/cases/service-auths";
import { createServiceAuthAction, saveServiceAuthAction } from "./actions";
import { SaSubmit } from "./sa-submit";

const input = "w-full rounded border border-slate-300 px-2 py-1";

/** Status list, keeping a stored off-list or odd-case value so an untouched save writes nothing. */
function statusOptions(cur: string): string[] {
  const list = SA_STATUSES.map((s) => (cur && s.toLowerCase() === cur.toLowerCase() ? cur : s));
  return cur && !list.includes(cur) ? [cur, ...list] : list;
}

function Input({ f, v, idp }: { f: SaField; v: string; idp: string }) {
  const common = { id: `${idp}-${f.col}`, name: f.col, defaultValue: v, className: input, required: f.required };
  switch (f.kind) {
    case "date": return <input {...common} type="date" />;
    case "hours": return <input {...common} type="number" step="0.001" min="0" inputMode="decimal" />;
    case "money": return <input {...common} type="number" step="0.01" inputMode="decimal" />;
    case "notes": return <textarea {...common} rows={2} />;
    case "status": return <select {...common}>{statusOptions(v).map((s) => <option key={s} value={s}>{s}</option>)}</select>;
    default: return <input {...common} />;
  }
}

/** One add/edit form; `row` null = add. Each input carries a `<col>__orig` with the value it was rendered with. */
function SaForm({ caseId, row, today, t }: { caseId: number; row: Row | null; today: string; t: string }) {
  const idp = row ? `sa-${row.srvauthid}` : "sa-new";
  const vals: Row = row ?? { srvauthdate: today, srvauthstatus: "Awaiting Approval" };
  return (
    // The key sits on the <form> itself: this React canary drops keys on Server Component
    // elements, so a key on <SaForm> never reached the client and forms matched by position.
    <form key={`${idp}-${t}`} action={saveServiceAuthAction.bind(null, caseId)} data-testid={row ? "sa-row" : "sa-add"} data-srvauthid={row ? String(row.srvauthid) : undefined}
      className="grid gap-2 rounded border border-slate-200 p-2 sm:grid-cols-4">
      {row && <input type="hidden" name="srvauthid" value={String(row.srvauthid)} />}
      {SA_FIELDS.map((f) => (
        <label key={f.col} htmlFor={`${idp}-${f.col}`} className={`grid gap-1 text-xs text-slate-600 ${f.kind === "notes" ? "sm:col-span-3" : ""}`}>
          {f.label}
          <Input f={f} v={saValue(f, vals)} idp={idp} />
          {row && <input type="hidden" name={`${f.col}__orig`} value={saValue(f, row)} />}
        </label>
      ))}
      <div className="flex items-end gap-3">
        <SaSubmit label={row ? "Update authorization" : "Add authorization"} />
        {row && isAppSaFile(caseId, row.srvauthfile) && <SaPdfLink row={row} />}
      </div>
    </form>
  );
}

const saPdfHref = (srvauthid: unknown) => `/cases/service-auths/pdf/${String(srvauthid)}`;
function SaPdfLink({ row, label = "PDF" }: { row: Row; label?: string }) {
  return <a href={saPdfHref(row.srvauthid)} download className="text-sm underline" data-testid="sa-pdf">{label}</a>;
}

/**
 * Service authorizations panel (legacy frmCaseServAuth): newest first, add and edit, no delete.
 * `rows` null = the read failed. `t` is the redirect's timestamp: it goes into every form key, so each
 * save remounts the forms — no row inherits another's DOM state, and the add form resets.
 */
export function ServiceAuthsPanel({ caseId, rows, today, t, saved, error, created }: { caseId: number; rows: Row[] | null; today: string; t: string; saved?: string; error?: string; created?: string }) {
  const made = created ? rows?.find((r) => String(r.srvauthid) === created) : undefined;
  return (
    <section id="service-auths" className="space-y-2 rounded border border-slate-200 p-3 md:col-span-2">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-semibold">Service authorizations</h2>
        <div className="flex items-center gap-3">
          <form action={createServiceAuthAction.bind(null, caseId)}>
            <SaSubmit label="Create SA" />
          </form>
          <Link href="/cases/service-auths" className="text-sm underline">All unapproved</Link>
        </div>
      </div>
      {made && (
        <p role="status" className="text-sm text-emerald-700" data-testid="sa-created">
          Service authorization created (Awaiting Approval). <SaPdfLink row={made} label={`Download ${String(made.srvauthfile)}.pdf`} />
        </p>
      )}
      {saved && <p role="status" className="text-sm text-emerald-700">{saved === "1" ? "Service authorization saved" : "No changes to save"}</p>}
      {error && <p role="alert" className="text-sm text-red-700">{saErrorMessage(error)}</p>}
      <h3 className="text-sm font-medium">Add</h3>
      <SaForm caseId={caseId} row={null} today={today} t={t} />
      {rows === null ? <p role="alert" className="text-sm text-red-700">Couldn&apos;t load service authorizations. Try again.</p>
        : rows.length === 0 ? <p className="text-sm text-slate-500">No service authorizations.</p>
        : rows.map((r) => <SaForm key={String(r.srvauthid)} caseId={caseId} row={r} today={today} t={t} />)}
    </section>
  );
}
