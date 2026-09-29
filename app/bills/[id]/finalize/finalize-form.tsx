"use client";

import { useState } from "react";
import { SaSubmit } from "@/app/cases/[id]/sa-submit";
import { summarize, type BillLine } from "@/lib/bills/lines";
import {
  MAX_ITEMS, centsText, finalLines, finalizeErrorMessage, rateKey, testimonyText, timesheetTotals, type FinalizeBase,
} from "@/lib/bills/finalize-model";
import { LinesTable } from "./lines-table";

const input = "rounded border border-slate-300 px-2 py-1";

/**
 * Finalize form: every box is controlled, and the preview + total run the same `finalLines` → `summarize` the server
 * action runs on the posted form, so the total on screen is the total saved. Save is disabled while a box is invalid.
 */
export function FinalizeForm({ base, initial, initials, fingerprint, action }: {
  base: FinalizeBase;
  initial: Record<string, string>;
  initials: Record<number, string>;
  fingerprint: string;
  action: (formData: FormData) => void | Promise<void>;
}) {
  const [v, setV] = useState(initial);
  const set = (k: string, val: string) => setV((cur) => {
    const next = { ...cur, [k]: val };
    // Trial: the testimony group follows a typed standard rate through the legacy map; blank when unmapped (type one).
    if (base.billType === "trial" && k === "g.0.rate") next["g.1.rate"] = testimonyText(val);
    return next;
  });
  const box = (k: string, label: string, hint?: string, extra: React.InputHTMLAttributes<HTMLInputElement> = {}) => {
    const id = `fin-${k.replaceAll(".", "-")}`;
    return (
      <span key={k} className="grid gap-1 text-sm">
        <label htmlFor={id}>{label}</label>
        <input id={id} name={k} value={v[k] ?? ""} onChange={(e) => set(k, e.target.value)} aria-describedby={hint ? `${id}-hint` : undefined} className={input} {...extra} />
        {hint && <span id={`${id}-hint`} className="text-xs text-slate-500">{hint}</span>}
      </span>
    );
  };

  let lines: BillLine[] | null = null;
  let problem: string | null = null;
  try {
    const l = finalLines(base, (k) => v[k] ?? "");
    summarize(l); // throws on a total the save would refuse
    lines = l;
  } catch (e) {
    problem = finalizeErrorMessage(e instanceof Error && "code" in e ? String(e.code) : "range");
  }

  return (
    <form action={action} data-testid="finalize-form" className="space-y-4">
      <input type="hidden" name="fingerprint" value={fingerprint} />
      {base.billType === "timesheet" && (
        <fieldset className="grid gap-3 rounded border border-slate-200 p-3 sm:grid-cols-2">
          <legend className="px-1 text-sm font-semibold">Hourly rate per person</legend>
          {timesheetTotals(base.input).map((l) => box(
            rateKey(l.personid),
            l.personid === null ? "Rate for time with no person" : `Rate for ${initials[l.personid] ?? `person ${l.personid}`}`,
            `default $${centsText(l.rate!)}`,
            { inputMode: "decimal" },
          ))}
        </fieldset>
      )}
      {base.model.groups.map((g, i) => {
        const n = Number(v[`g.${i}.n`] ?? g.items.length);
        return (
          <fieldset key={i} className="space-y-2 rounded border border-slate-200 p-3">
            <legend className="px-1 text-sm font-semibold">Estimate {i + 1}</legend>
            <input type="hidden" name={`g.${i}.n`} value={String(n)} />
            {Array.from({ length: n }, (_, j) => (
              <div key={j} className="grid gap-2 sm:grid-cols-[1fr_8rem]">
                {box(`g.${i}.${j}.desc`, `Estimate ${i + 1} line ${j + 1} description`)}
                {box(`g.${i}.${j}.hours`, `Estimate ${i + 1} line ${j + 1} hours`, undefined, { inputMode: "decimal" })}
              </div>
            ))}
            <div className="flex flex-wrap items-end gap-3">
              {box(`g.${i}.rate`, `Estimate ${i + 1} rate`,
                `default $${centsText(g.rate)}${base.billType === "trial" && i === 1 ? " — follows Estimate 1's rate; type one if blank" : ""}`,
                { inputMode: "decimal" })}
              {n < MAX_ITEMS && (
                <button type="button" onClick={() => set(`g.${i}.n`, String(n + 1))} className="rounded border border-slate-300 px-2 py-1 text-sm">
                  Add line
                </button>
              )}
            </div>
          </fieldset>
        );
      })}
      {base.model.flats.length > 0 && (
        <fieldset className="space-y-2 rounded border border-slate-200 p-3">
          <legend className="px-1 text-sm font-semibold">Flat amounts</legend>
          {base.model.flats.map((f, k) => (
            <div key={k} className="grid gap-2 sm:grid-cols-[1fr_8rem]">
              {box(`f.${k}.desc`, `${f.kind === "expense" ? "Expense" : "Charge"} ${k + 1} description`)}
              {box(`f.${k}.amount`, `${f.kind === "expense" ? "Expense" : "Charge"} ${k + 1} amount`, undefined, { inputMode: "decimal" })}
            </div>
          ))}
        </fieldset>
      )}
      {problem && <p role="alert" className="text-sm text-red-700">{problem}</p>}
      {lines && <LinesTable lines={lines} testid="finalize-preview" />}
      <SaSubmit label="Finalize bill" disabled={!!problem} />
    </form>
  );
}
