"use client";

import { useFormState } from "react-dom";
import { deactivateAction, setBillingPersonAction, setRoleAction, type ManageState } from "./actions";

type Props = {
  userId: string;
  email: string;
  role: string;
  personid: number | null;
  billing: { personid: number; initials: string }[];
};

// Visible outcome. role="status", not "alert" — Next's route announcer owns role="alert".
function Outcome({ state, label }: { state: ManageState; label: string }) {
  if (!state) return null;
  return (
    <p role="status" aria-label={label} className={`text-xs ${state.ok ? "text-emerald-700" : "text-red-700"}`}>
      {state.ok ? state.message : state.error}
    </p>
  );
}

const btn = "rounded border border-slate-300 px-2 py-0.5 text-xs hover:bg-slate-100";
const sel = "rounded border border-slate-300 px-1 py-0.5 text-xs";

export function RowControls({ userId, email, role, personid, billing }: Props) {
  const [roleState, roleAction] = useFormState<ManageState, FormData>(setRoleAction, null);
  const [billState, billAction] = useFormState<ManageState, FormData>(setBillingPersonAction, null);
  const [deactState, deactAction] = useFormState<ManageState, FormData>(deactivateAction, null);

  return (
    <div className="space-y-1">
      <div className="flex flex-wrap items-center gap-2">
        <form action={roleAction} className="flex items-center gap-1">
          <input type="hidden" name="userId" value={userId} />
          <select name="role" defaultValue={role} aria-label={`Role for ${email}`} className={sel}>
            <option value="staff">staff</option>
            <option value="admin">admin</option>
          </select>
          <button type="submit" className={btn}>Save role</button>
        </form>
        <form action={billAction} className="flex items-center gap-1">
          <input type="hidden" name="userId" value={userId} />
          <select name="personid" defaultValue={personid == null ? "" : String(personid)} aria-label={`Billing person for ${email}`} className={sel}>
            <option value="">— none —</option>
            {billing.map((b) => (
              <option key={b.personid} value={b.personid}>{b.initials}</option>
            ))}
          </select>
          <button type="submit" className={btn}>Save billing person</button>
        </form>
        <form
          action={deactAction}
          onSubmit={(e) => {
            if (!confirm(`Deactivate ${email}? They will no longer be able to sign in.`)) e.preventDefault();
          }}
        >
          <input type="hidden" name="userId" value={userId} />
          <button type="submit" className={`${btn} text-red-700`}>Deactivate</button>
        </form>
      </div>
      <Outcome state={roleState} label={`Role result for ${email}`} />
      <Outcome state={billState} label={`Billing person result for ${email}`} />
      <Outcome state={deactState} label={`Deactivate result for ${email}`} />
    </div>
  );
}
