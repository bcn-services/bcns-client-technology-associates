"use client";

import { useState } from "react";
import { useFormState } from "react-dom";
import { SaSubmit } from "@/app/cases/[id]/sa-submit";
import type { EmailDraft, SendState } from "@/lib/bills/send";

const input = "rounded border border-slate-300 px-2 py-1";

/**
 * The editable email preview. Fields are uncontrolled (defaultValue), so a refused send keeps what was typed.
 * Send is disabled until email is configured and, on an alert case, the alert box is ticked; the server re-checks both.
 */
export function SendForm({ draft, alert, emailOn, token, sentat, notice, pdfHref, pdfName, action }: {
  draft: EmailDraft;
  alert: boolean;
  emailOn: boolean;
  token: string;
  sentat: string;
  /** Notice resend: the notice the preview rendered (the server refuses if the bill has moved on). */
  notice?: string;
  pdfHref: string;
  pdfName: string;
  action: (prev: SendState, formData: FormData) => Promise<SendState>;
}) {
  const [state, formAction] = useFormState(action, null);
  const [ticked, setTicked] = useState(false);
  const field = (name: keyof EmailDraft, label: string, multiline = false) => (
    <label className="grid gap-1 text-sm">
      <span>{label}</span>
      {multiline
        ? <textarea name={name} rows={8} defaultValue={draft[name]} className={input} />
        : <input name={name} defaultValue={draft[name]} className={input} />}
    </label>
  );
  return (
    <form action={formAction} data-testid="send-form" className="space-y-3">
      <input type="hidden" name="token" value={token} />
      <input type="hidden" name="sentat" value={sentat} />
      {notice !== undefined && <input type="hidden" name="notice" value={notice} />}
      {field("to", "To")}
      {field("cc", "CC")}
      {field("bcc", "BCC")}
      {field("subject", "Subject")}
      {field("body", "Message", true)}
      <p className="text-sm">
        Attachment: <a href={pdfHref} target="_blank" rel="noopener" data-testid="send-pdf" className="underline">{pdfName}</a>
      </p>
      {alert && (
        <label data-testid="bill-recipient-alert" className="flex items-start gap-2 rounded border border-amber-300 bg-amber-50 px-3 py-2 text-sm font-medium text-amber-900">
          <input type="checkbox" name="alertok" value="1" checked={ticked} onChange={(e) => setTicked(e.target.checked)} className="mt-1" />
          <span>Bill recipient alert — this case bills a different party. I checked the recipients above.</span>
        </label>
      )}
      {!emailOn && <p role="status" data-testid="send-off" className="text-sm text-slate-600">Email is not set up yet, so Send is turned off. The preview and the PDF still work.</p>}
      {state && <p role="alert" data-testid="send-error" className="text-sm text-red-700">{state.message}</p>}
      <SaSubmit label="Send" disabled={!emailOn || (alert && !ticked)} />
    </form>
  );
}
