"use client";

import { createContext, useContext, useOptimistic, type ReactNode } from "react";
import type { TicketStatus } from "@/lib/tickets";
import { SubmitButton } from "./submit-button";

const BADGE = { "In review": "bg-blue-100 text-blue-800", Open: "bg-amber-100 text-amber-800", Closed: "bg-green-100 text-green-800" } as const;
type Server = (formData: FormData) => Promise<void>;
type Ctx = { shown: TicketStatus; show: (to: TicketStatus) => void };
const Status = createContext<Ctx | null>(null);
const useStatus = () => useContext(Status) ?? { shown: "Open" as TicketStatus, show: () => {} };

/**
 * Wraps one ticket row (renders no DOM of its own) so the badge and the buttons, which sit in different cells, share one status.
 * `show` flips it at once; React drops the flip when the form action settles, so the server-rendered `status` (the redirect's
 * fresh data, or the unchanged row after a ?error=) takes over: that is the revert.
 */
export function TicketStatusProvider({ status, children }: { status: TicketStatus; children: ReactNode }) {
  const [shown, show] = useOptimistic<TicketStatus, TicketStatus>(status, (_current, to) => to);
  return <Status.Provider value={{ shown, show }}>{children}</Status.Provider>;
}

export function StatusBadge() {
  const { shown } = useStatus();
  return <span className={`whitespace-nowrap rounded px-2 py-0.5 text-xs ${BADGE[shown]}`}>{shown}</span>;
}

/** Flip first, then run the server action; the flip lives only as long as the action (a form action runs as a transition). */
export const flipThen = (show: (to: TicketStatus) => void, to: TicketStatus, action: Server): Server => async (formData) => {
  show(to);
  await action(formData);
};

export function RowActions({ id, close, reopen }: { id: number; close: Server; reopen: Server }) {
  const { shown, show } = useStatus();
  return (
    <form className="flex flex-col items-end gap-1">
      <input type="hidden" name="id" value={id} />
      <label className="sr-only" htmlFor={`resp-${id}`}>Response (optional)</label>
      <textarea id={`resp-${id}`} name="response" maxLength={2000} rows={1} placeholder="Response (optional)" className="w-48 rounded border px-2 py-1" />
      <span className="flex gap-1">
        {shown !== "Closed" && <SubmitButton label="Close" formAction={flipThen(show, "Closed", close)} className="rounded border border-slate-300 px-3 py-1" />}
        {shown !== "Open" && <SubmitButton label="Reopen" formAction={flipThen(show, "Open", reopen)} className="rounded border border-slate-300 px-3 py-1" />}
      </span>
    </form>
  );
}
