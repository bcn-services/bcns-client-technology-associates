"use client";

import Link from "next/link";
import { useFormState, useFormStatus } from "react-dom";
import type { FormState } from "../actions";

type Opt = { id: number | string; name: string };
type Props = {
  inquiryId: number;
  existingCase: number | null;
  attorneys: Opt[];
  clients: Opt[];
  branches: string[];
  defaultAttorney: string;
  defaultBranch: string;
  action: (prev: FormState, fd: FormData) => Promise<FormState>;
};

const input = "rounded border border-slate-300 px-2 py-1";

/** Disabled while the action runs: a double click must not make two cases. */
function ConvertButton() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} className="rounded border border-slate-300 bg-slate-800 px-3 py-1 text-sm text-white hover:bg-slate-700 disabled:opacity-60">
      Convert to case
    </button>
  );
}

function Picker({ id, name, label, opts, value }: { id: string; name: string; label: string; opts: { value: string; label: string }[]; value: string }) {
  return (
    <div className="grid gap-1 text-sm">
      <label htmlFor={id}>{label}</label>
      <select id={id} name={name} defaultValue={value} required className={input}>
        <option value="" />
        {opts.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </div>
  );
}

function ConvertForm(p: Props) {
  const [state, formAction] = useFormState(p.action, null);
  const ids = (xs: Opt[]) => xs.map((x) => ({ value: String(x.id), label: x.name }));
  return (
    <form action={formAction} className="space-y-3" data-testid="convert-form">
      <input type="hidden" name="inquiryId" value={p.inquiryId} />
      {state?.error && <p role="alert" className="rounded border border-red-300 bg-red-50 p-2 text-sm text-red-800">{state.error}</p>}
      <div className="grid gap-3 sm:grid-cols-3">
        <Picker id="cv-caseatty" name="caseatty" label="Case attorney" opts={ids(p.attorneys)} value={p.defaultAttorney} />
        <Picker id="cv-caseclient" name="caseclient" label="Case client" opts={ids(p.clients)} value="" />
        <Picker id="cv-tabranch" name="tabranch" label="Case branch" opts={p.branches.map((b) => ({ value: b, label: b }))} value={p.defaultBranch} />
      </div>
      <ConvertButton />
    </form>
  );
}

/** An inquiry that already has a case links to it; otherwise the convert form. */
export function ConvertPanel(p: Props) {
  return (
    <section className="space-y-3 rounded border border-slate-200 p-4" aria-labelledby="convert-h">
      <h2 id="convert-h" className="font-semibold">Case from this inquiry</h2>
      {p.existingCase != null
        ? <p className="text-sm" data-testid="converted-case">Converted: <Link href={`/cases/${p.existingCase}`} className="underline">Case {p.existingCase}</Link></p>
        : <ConvertForm {...p} />}
    </section>
  );
}
