"use client";

import type { ReactNode } from "react";
import { useFormState, useFormStatus } from "react-dom";
import { createCaseAction, type NewCaseState } from "./actions";

function Submit() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} className="rounded border border-slate-300 bg-slate-800 px-3 py-1 text-sm text-white hover:bg-slate-700 disabled:opacity-60">
      {pending ? "Saving…" : "Save case"}
    </button>
  );
}

/** The form keeps what was typed when a save is refused (e.g. "Case number already exists"). */
export function NewCaseForm({ children }: { children: ReactNode }) {
  const [state, action] = useFormState<NewCaseState, FormData>(createCaseAction, null);
  return (
    <form action={action} className="space-y-4">
      {state?.error && <p role="alert" className="text-sm text-red-700">{state.error}</p>}
      {children}
      <Submit />
    </form>
  );
}
