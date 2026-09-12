"use client";

import { useState, type ReactNode } from "react";

/** The record opens locked; Unlock enables the fields (UI state only, not a database lock). */
export function LockedForm({ action, children }: { action: (formData: FormData) => void | Promise<void>; children: ReactNode }) {
  const [locked, setLocked] = useState(true);
  return (
    <form action={action} className="space-y-6">
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={() => setLocked((l) => !l)} aria-pressed={!locked} className="rounded border border-slate-300 px-3 py-1 text-sm hover:bg-slate-100">
          {locked ? "Unlock" : "Lock"}
        </button>
        {!locked && <button type="submit" className="rounded border border-slate-300 bg-slate-800 px-3 py-1 text-sm text-white hover:bg-slate-700">Save</button>}
        {locked && <span className="text-sm text-slate-500">Locked — Unlock to edit.</span>}
      </div>
      <fieldset disabled={locked} className="space-y-6 disabled:opacity-90">
        {children}
      </fieldset>
    </form>
  );
}
