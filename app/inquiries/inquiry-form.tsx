"use client";

import { useFormState, useFormStatus } from "react-dom";
import type { FormState } from "./actions";
import type { InquiryOptions, InquiryRow } from "@/lib/inquiries/inquiries";

type Values = Partial<InquiryRow>;
const CALLER_TITLES = ["Attorney", "Paralegal", "Secretary", "Insurance Claims Rep", "Investigator"];
const CLIENT_ROLES = ["Plaintiff", "Defendant", "Third Party", "Unknown", "Other"];

const input = "rounded border border-slate-300 px-2 py-1";
const box = "grid gap-1 text-sm";

function Text({ name, label, v, list, type = "text" }: { name: keyof InquiryRow; label: string; v: Values; list?: string; type?: string }) {
  const val = v[name];
  return (
    <label className={box}>
      {label}
      <input name={name} type={type} list={list} defaultValue={val == null ? "" : String(val)} className={input} />
    </label>
  );
}

/** A select over a value list; a legacy value outside the list is kept as an extra option so editing never drops it. */
function Pick({ name, label, v, options }: { name: keyof InquiryRow; label: string; v: Values; options: { value: string; label: string }[] }) {
  const cur = v[name] == null ? "" : String(v[name]);
  const all = cur && !options.some((o) => o.value.toLowerCase() === cur.toLowerCase()) ? [...options, { value: cur, label: cur }] : options;
  const selected = all.find((o) => o.value.toLowerCase() === cur.toLowerCase())?.value ?? "";
  return (
    <label className={box}>
      {label}
      <select name={name} defaultValue={selected} className={input}>
        <option value="" />
        {all.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
    </label>
  );
}

function Check({ name, label, v }: { name: keyof InquiryRow; label: string; v: Values }) {
  return (
    <label className="flex items-center gap-2 text-sm">
      <input type="checkbox" name={name} defaultChecked={v[name] === true} />
      {label}
    </label>
  );
}

function Submit() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} className="rounded border border-slate-300 px-3 py-1 hover:bg-slate-100">
      {pending ? "Saving…" : "Save"}
    </button>
  );
}

const asOptions = (xs: string[]) => xs.map((x) => ({ value: x, label: x }));

export function InquiryForm({ action, values: v, options }: {
  action: (prev: FormState, fd: FormData) => Promise<FormState>;
  values: Values;
  options: InquiryOptions;
}) {
  const [state, formAction] = useFormState(action, null);
  const branches = asOptions(options.branches);
  return (
    <form action={formAction} className="space-y-6">
      {v.id != null && <input type="hidden" name="id" value={v.id} />}
      <datalist id="inq-subjects">{options.subjects.map((s) => <option key={s} value={s} />)}</datalist>
      <datalist id="inq-howheard">{options.howHeard.map((s) => <option key={s} value={s} />)}</datalist>
      <datalist id="inq-engineers">{options.engineers.map((s) => <option key={s} value={s} />)}</datalist>

      <fieldset className="grid gap-3 sm:grid-cols-3">
        <Text name="inqdate" label="Date" type="date" v={v} />
        <Text name="inqtime" label="Time" type="time" v={{ ...v, inqtime: v.inqtime?.slice(0, 5) ?? null }} />
        <Text name="inqreceptionist" label="Receptionist" v={v} />
        <Text name="inqcallername" label="Caller name" v={v} />
        <Pick name="inqcallertitle" label="Caller title" v={v} options={asOptions(CALLER_TITLES)} />
        <Text name="inqattyname" label="Attorney name (if not caller)" v={v} />
        <Pick name="inqattyid" label="Attorney" v={v} options={options.attorneys.map((a) => ({ value: String(a.id), label: a.name }))} />
        <Text name="inqfirm" label="Firm" v={v} />
        <Text name="inqfirmlocation" label="Firm location" v={v} />
        <Text name="inqlocation" label="Caller location" v={v} />
        <Text name="inqaccidentlocation" label="Accident location" v={v} />
        <Text name="inqphonenumber" label="Phone" v={v} />
        <Text name="inqaltphonenumber" label="Alt phone" v={v} />
        <Text name="inqfaxnumber" label="Fax" v={v} />
        <Text name="inqemail" label="Email" v={v} />
        <Text name="inqcaption" label="Caption" v={v} />
        <Text name="inqsubject" label="Subject" list="inq-subjects" v={v} />
        <Pick name="tabranch" label="Branch" v={v} options={branches} />
        <Text name="inqrefferredby" label="Referred by" v={v} />
        <Text name="inqhowheardaboutus" label="How heard" list="inq-howheard" v={v} />
        <Text name="inqpreviouscase" label="Previous case" v={v} />
        <Pick name="inqclient" label="Client role" v={v} options={asOptions(CLIENT_ROLES)} />
        <Text name="inqengineer" label="Engineer" list="inq-engineers" v={v} />
      </fieldset>

      <label className={box}>
        Description
        <textarea name="inqdescription" rows={4} defaultValue={v.inqdescription ?? ""} className={input} />
      </label>

      <fieldset className="space-y-3 rounded border border-slate-200 p-3">
        <legend className="px-1 text-sm font-medium">Sent</legend>
        <div className="grid gap-2 sm:grid-cols-3">
          <Check name="sentfee" label="Fee schedule" v={v} />
          <Check name="sentchecklist" label="Checklist" v={v} />
          <Check name="sentllb" label="LLB" v={v} />
          <Check name="sentkjs" label="KJS" v={v} />
          <Check name="sentiuo" label="IUO" v={v} />
          <Check name="sentiuobio" label="IUO-Biomech" v={v} />
          <Check name="sentoren" label="Oren" v={v} />
          <Check name="sentlarry" label="Larry" v={v} />
          <Check name="sentcoppolino" label="Coppolino" v={v} />
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="flex items-end gap-2"><Check name="sentother1" label="Other 1" v={v} /><Text name="sentother1name" label="Other 1 name" v={v} /></div>
          <div className="flex items-end gap-2"><Check name="sentother2" label="Other 2" v={v} /><Text name="sentother2name" label="Other 2 name" v={v} /></div>
        </div>
        <div className="grid gap-3 sm:grid-cols-4">
          <Text name="sentinfo1" label="Info sheet 1" v={v} />
          <Text name="sentinfo2" label="Info sheet 2" v={v} />
          <Text name="sentinfo3" label="Info sheet 3" v={v} />
          <Pick name="sentbranch" label="Branch for info" v={v} options={branches} />
        </div>
      </fieldset>

      {state?.error && <p role="alert" className="text-sm text-red-700">{state.error}</p>}
      <Submit />
    </form>
  );
}
