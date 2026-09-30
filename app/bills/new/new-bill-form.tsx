"use client";

import { useState } from "react";
import Link from "next/link";
import { SaSubmit } from "@/app/cases/[id]/sa-submit";
import { BILL_TYPES, START_NOTICES } from "@/lib/bills/rules";
import type { NewBillData } from "@/lib/bills/create";
import { fmtHours, thousandths } from "@/lib/time/week";
import { RecipientAlert } from "../recipient-alert";

const input = "rounded border border-slate-300 px-2 py-1";
const sum = (rows: { acthrs: number | string }[]) => fmtHours(rows.reduce((t, r) => t + thousandths(r.acthrs), 0));

/**
 * Create-bill form. Picking a type re-checks the rows: all for timesheet, none otherwise.
 * The "selected" figure is display only — the action sums the checked rows from the DB.
 */
export function NewBillForm({ data, action, error }: {
  data: NewBillData;
  action: (formData: FormData) => void | Promise<void>;
  error?: string;
}) {
  const { caseid, casetitle, rows, today } = data;
  const all = () => new Set(rows.map((r) => r.actid));
  const [checked, setChecked] = useState<Set<number>>(all);
  const toggle = (id: number) => setChecked((s) => {
    const n = new Set(s);
    if (!n.delete(id)) n.add(id);
    return n;
  });
  return (
    <form action={action} data-testid="bill-create" className="max-w-2xl space-y-3">
      {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
      <p className="text-sm">
        <Link href={`/cases/${caseid}`} className="underline">{`Case ${caseid}: ${casetitle}`}</Link>
      </p>
      <RecipientAlert alert={data.billingalert} cc={data.billingcc} />
      <input type="hidden" name="caseid" value={caseid} />
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="grid gap-1 text-sm">Bill type
          <select name="billtype" defaultValue="timesheet" className={input}
            onChange={(e) => setChecked(e.target.value === "timesheet" ? all() : new Set())}>
            {BILL_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </label>
        <label className="grid gap-1 text-sm">Bill date
          <input name="billdate" type="date" required defaultValue={today} className={input} />
        </label>
        <label className="grid gap-1 text-sm">Balance (optional — Finalize sets it)
          <input name="billbalance" inputMode="decimal" pattern="-?[0-9,]{1,13}(\.[0-9]{1,2})?" placeholder="set at Finalize" className={input} />
        </label>
        <label className="grid gap-1 text-sm">Start status
          <select name="billnotice" defaultValue="1st" className={input}>
            {[...START_NOTICES].map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
        </label>
      </div>
      <fieldset className="space-y-1 rounded border border-slate-200 p-3">
        <legend className="px-1 text-sm font-semibold">Time to bill</legend>
        <p className="text-sm">Unbilled hours: <span className="tabular-nums">{sum(rows)}</span></p>
        {rows.length === 0 ? (
          <p className="text-sm text-slate-500">No unbilled time on this case</p>
        ) : (
          <>
            {rows.map((r) => (
              <label key={r.actid} data-testid="bill-row" className="flex gap-2 text-sm">
                <input type="checkbox" name="actid" value={r.actid} checked={checked.has(r.actid)} onChange={() => toggle(r.actid)} />
                <span>{r.actdate}</span>
                <span>{r.initials || "—"}</span>
                <span className="flex-1">{r.actdescription}</span>
                <span className="tabular-nums">{fmtHours(thousandths(r.acthrs))}</span>
              </label>
            ))}
            <p className="text-sm text-slate-600">Selected: <span className="tabular-nums">{sum(rows.filter((r) => checked.has(r.actid)))}</span> h</p>
          </>
        )}
      </fieldset>
      <label className="flex items-center gap-2 text-sm">
        <input name="billestimate" type="checkbox" /> Estimate
      </label>
      <label className="grid gap-1 text-sm">Comments
        <textarea name="billcomments" rows={3} className={input} />
      </label>
      <SaSubmit label="Create bill" />
    </form>
  );
}
