"use client";

import { useFormState, useFormStatus } from "react-dom";
import { createUserAction, type CreateState } from "./actions";

function Submit() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} className="rounded border border-slate-300 px-3 py-1 hover:bg-slate-100">
      {pending ? "Creating…" : "Create user"}
    </button>
  );
}

export function CreateUserForm() {
  const [state, action] = useFormState<CreateState, FormData>(createUserAction, null);
  return (
    <section aria-label="Create user" className="space-y-3">
      <form action={action} className="flex flex-wrap items-end gap-2">
        <label htmlFor="new-email" className="grid gap-1 text-sm">
          New user email
          <input id="new-email" name="email" type="email" required autoComplete="off" className="rounded border border-slate-300 px-2 py-1" />
        </label>
        <Submit />
      </form>
      {state && !state.ok && (
        <p role="alert" className="text-sm text-red-700">
          {state.error}
        </p>
      )}
      {state?.ok && state.password === null && (
        <p role="status" className="rounded border border-emerald-300 bg-emerald-50 p-3 text-sm">
          Reactivated <strong>{state.email}</strong> as staff. They sign in with their existing password.
        </p>
      )}
      {state?.ok && state.password !== null && (
        <div role="status" className="rounded border border-amber-300 bg-amber-50 p-3 text-sm">
          <p>
            Created <strong>{state.email}</strong>. Temporary password (shown once — read it to them now):
          </p>
          <p>
            <code data-testid="temp-password" className="text-base">{state.password}</code>
          </p>
        </div>
      )}
    </section>
  );
}
