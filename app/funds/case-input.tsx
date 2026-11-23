"use client";

import { useRef } from "react";
import { caseFundsDefaultsAction } from "./actions";

/**
 * Case input for /funds/new: on blur with a case number, fills Source/Description when they are empty or
 * still hold what this input last filled (so a corrected case number refreshes them). Typed text is never overwritten.
 */
export function CaseInput({ fillOnBlur, ...props }: React.InputHTMLAttributes<HTMLInputElement> & { fillOnBlur?: boolean }) {
  const filled = useRef<Record<string, string>>({});
  async function onBlur(e: React.FocusEvent<HTMLInputElement>) {
    const input = e.currentTarget;
    const { form, value } = input;
    if (!fillOnBlur || !form || !/^\d{1,9}$/.test(value.trim())) return;
    const d = await caseFundsDefaultsAction(value).catch(() => null);
    if (!d || input.value.trim() !== value.trim()) return; // a stale answer for a number the user has since changed
    for (const [name, val] of [["source", d.source], ["description", d.description]] as const) {
      const el = form.elements.namedItem(name) as HTMLInputElement | HTMLTextAreaElement | null;
      // checked at fill time: the user may have typed during the fetch
      if (el && (!el.value || el.value === filled.current[name])) {
        el.value = val;
        filled.current[name] = val;
      }
    }
  }
  return <input {...props} onBlur={onBlur} />;
}
