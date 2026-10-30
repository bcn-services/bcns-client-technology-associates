"use client";

import { createContext, useContext, useOptimistic, useState, type ReactNode } from "react";
import { useFormStatus } from "react-dom";
import type { TicketStatus } from "@/lib/tickets";
import { SubmitButton } from "./submit-button";

const BADGE = { "In review": "bg-blue-100 text-blue-800", Open: "bg-amber-100 text-amber-800", Closed: "bg-green-100 text-green-800" } as const;
type Server = (formData: FormData) => Promise<void>;
type Ctx = { status: TicketStatus; shown: TicketStatus; show: (to: TicketStatus) => void };
const Status = createContext<Ctx | null>(null);
const useStatus = () => useContext(Status) ?? { status: "Open" as TicketStatus, shown: "Open" as TicketStatus, show: () => {} };

/**
 * Wraps one ticket row (renders no DOM of its own) so the badge and the buttons, which sit in different cells, share one status.
 * `show` flips it at once; React drops the flip when the form action settles, so the server-rendered `status` (the redirect's
 * fresh data, or the unchanged row after a ?error=) takes over: that is the revert.
 */
export function TicketStatusProvider({ status, children }: { status: TicketStatus; children: ReactNode }) {
  const [shown, show] = useOptimistic<TicketStatus, TicketStatus>(status, (_current, to) => to);
  return <Status.Provider value={{ status, shown, show }}>{children}</Status.Provider>;
}

export function StatusBadge() {
  const { shown } = useStatus();
  return <span className={`whitespace-nowrap rounded px-2 py-0.5 text-xs ${BADGE[shown]}`}>{shown}</span>;
}

/**
 * Flip first, then run the server action; the flip lives only as long as the action (a form action runs as a transition).
 * ponytail: a closure as formAction has no no-JS / pre-hydration POST fallback (a server action passed directly would) — fine for a
 * staff app with JS on; pass the server action itself with a hidden target-status field if that ever has to work.
 */
export const flipThen = (show: (to: TicketStatus) => void, to: TicketStatus, action: Server): Server => async (formData) => {
  show(to);
  await action(formData);
};

/** Two clicks, no window.confirm: Delete only arms "Confirm delete". Lives inside the row form so it can read the form's pending state. */
function DeleteControl({ remove }: { remove: Server }) {
  const { pending } = useFormStatus();
  const [confirming, setConfirming] = useState(false);
  return (
    <span className="flex gap-1">
      {confirming ? (
        <>
          <SubmitButton label="Confirm delete" formAction={remove} className="rounded border border-red-300 px-3 py-1 text-red-700" />
          <button type="button" disabled={pending} onClick={() => setConfirming(false)} className="rounded border border-slate-300 px-3 py-1 disabled:opacity-60">Cancel</button>
        </>
      ) : (
        <button type="button" disabled={pending} onClick={() => setConfirming(true)} className="rounded border border-red-300 px-3 py-1 text-red-700 disabled:opacity-60">Delete</button>
      )}
    </span>
  );
}

export function RowActions({ id, close, reopen, review, remove }: { id: number; close: Server; reopen: Server; review: Server; remove?: Server }) {
  const { status, shown, show } = useStatus();
  // The clicked button unmounts on the flip, so while the flip is unconfirmed the control that took its place says "Saving…" (disabled via useFormStatus).
  const saving = shown !== status;
  return (
    <form className="flex flex-col items-end gap-1">
      <input type="hidden" name="id" value={id} />
      <label className="sr-only" htmlFor={`resp-${id}`}>Response (optional)</label>
      <textarea id={`resp-${id}`} name="response" maxLength={2000} rows={1} placeholder="Response (optional)" className="w-48 rounded border px-2 py-1" />
      <span className="flex gap-1">
        {shown === "Open" && !saving && <SubmitButton label="Reply" formAction={flipThen(show, "In review", review)} className="rounded border border-slate-300 px-3 py-1" />}
        {shown !== "Closed" && <SubmitButton label={saving ? "Saving…" : "Close"} formAction={flipThen(show, "Closed", close)} className="rounded border border-slate-300 px-3 py-1" />}
        {shown !== "Open" && <SubmitButton label={saving ? "Saving…" : "Reopen"} formAction={flipThen(show, "Open", reopen)} className="rounded border border-slate-300 px-3 py-1" />}
      </span>
      {/* Delete is for Closed tickets (see deleteTicket) and only offered to admins (`remove` is omitted for staff). */}
      {remove && shown === "Closed" && (
        <DeleteControl remove={remove} />
      )}
    </form>
  );
}
