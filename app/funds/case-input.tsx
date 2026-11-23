"use client";

import { caseFundsDefaultsAction } from "./actions";

/** Case input for /funds/new: on blur with a case number, fills Source/Description if still empty (never overwrites typing). */
export function CaseInput({ fillOnBlur, ...props }: React.InputHTMLAttributes<HTMLInputElement> & { fillOnBlur?: boolean }) {
  async function onBlur(e: React.FocusEvent<HTMLInputElement>) {
    const { form, value } = e.currentTarget;
    if (!fillOnBlur || !form || !/^\d{1,9}$/.test(value.trim())) return;
    const d = await caseFundsDefaultsAction(value).catch(() => null);
    if (!d) return;
    for (const [name, val] of [["source", d.source], ["description", d.description]] as const) {
      const el = form.elements.namedItem(name) as HTMLInputElement | HTMLTextAreaElement | null;
      if (el && !el.value && val) el.value = val; // checked at fill time: the user may have typed during the fetch
    }
  }
  return <input {...props} onBlur={onBlur} />;
}
