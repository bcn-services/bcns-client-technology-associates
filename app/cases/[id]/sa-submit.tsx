"use client";

import { useFormStatus } from "react-dom";

/** Disabled while the action runs, so a double-click can't insert two rows (there is no delete). */
export function SaSubmit({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} className="rounded border border-slate-300 bg-slate-800 px-3 py-1 text-sm text-white hover:bg-slate-700 disabled:opacity-60">
      {label}
    </button>
  );
}
