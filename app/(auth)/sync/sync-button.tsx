"use client";

import { useFormState, useFormStatus } from "react-dom";
import { syncAction, type SyncActionState } from "./actions";

const CONFIRM =
  "Replace all case, client, billing, expense and funds data with the newest Access backup? " +
  "Anything entered in this app since that backup in those tables, including finalized bill lines, is lost. " +
  "Time entries, users, bank imports, the audit log and tickets are kept; time billed in this app becomes unbilled again, because those bills are replaced. " +
  "Takes about an hour. Nobody should enter data until it finishes.";

function Submit({ disabled }: { disabled: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={disabled || pending}
      className="rounded border border-slate-300 px-3 py-1 text-sm hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
    >
      Sync from Access
    </button>
  );
}

export function SyncButton({ canSync, reason }: { canSync: boolean; reason?: string }) {
  const [state, action] = useFormState<SyncActionState, FormData>(syncAction, null);
  return (
    <form
      action={action}
      className="space-y-1"
      onSubmit={(e) => {
        if (!confirm(CONFIRM)) e.preventDefault();
      }}
    >
      <Submit disabled={!canSync} />
      {!canSync && reason && <p className="text-xs text-slate-600">{reason}</p>}
      {/* role="status", not "alert": Next's route announcer owns role="alert". */}
      {state && (
        <p role="status" aria-label="Sync result" className={`text-xs ${state.ok ? "text-emerald-700" : "text-red-700"}`}>
          {state.ok ? state.message : state.error}
        </p>
      )}
    </form>
  );
}
