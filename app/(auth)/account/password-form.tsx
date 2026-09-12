"use client";

import { useFormState, useFormStatus } from "react-dom";
import { changePasswordAction, type PasswordState } from "./actions";

function Submit() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} className="rounded border border-slate-300 px-3 py-1 hover:bg-slate-100">
      {pending ? "Changing…" : "Change password"}
    </button>
  );
}

const FIELDS = [
  { name: "current", label: "Current password", autoComplete: "current-password" },
  { name: "new", label: "New password", autoComplete: "new-password" },
  { name: "confirm", label: "Confirm new password", autoComplete: "new-password" },
] as const;

export function PasswordForm() {
  const [state, action] = useFormState<PasswordState, FormData>(changePasswordAction, null);
  return (
    <section aria-label="Change password" className="max-w-sm space-y-3">
      <form action={action} className="grid gap-3">
        {FIELDS.map((f) => (
          <label key={f.name} htmlFor={`pw-${f.name}`} className="grid gap-1 text-sm">
            {f.label}
            <input id={`pw-${f.name}`} name={f.name} type="password" required autoComplete={f.autoComplete} className="rounded border border-slate-300 px-2 py-1" />
          </label>
        ))}
        <div>
          <Submit />
        </div>
      </form>
      {state && !state.ok && (
        <p role="alert" className="text-sm text-red-700">
          {state.error}
        </p>
      )}
      {state?.ok && (
        <p role="status" className="text-sm text-green-700">
          Password changed.
        </p>
      )}
    </section>
  );
}
