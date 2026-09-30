"use client";

import { useFormState, useFormStatus } from "react-dom";
import { uploadCaseDocument, type UploadState } from "./actions";

function Submit() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} className="rounded border border-slate-300 px-3 py-1 text-sm hover:bg-slate-100 disabled:opacity-60">
      {pending ? "Uploading…" : "Upload"}
    </button>
  );
}

/** Upload a file against one case. Errors stay on the panel — the case page never sees a query string. */
export function UploadForm({ caseId, disabled }: { caseId: number; disabled?: boolean }) {
  const [state, action] = useFormState<UploadState, FormData>(uploadCaseDocument, null);
  return (
    <form action={action} className="flex flex-wrap items-center gap-2 text-sm">
      <input type="hidden" name="caseid" value={caseId} />
      <label htmlFor={`doc-file-${caseId}`} className="sr-only">Document file</label>
      <input id={`doc-file-${caseId}`} name="file" type="file" required disabled={disabled} className="text-sm" />
      {!disabled && <Submit />}
      {state && "error" in state && <p role="alert" className="w-full text-red-700">{state.error}</p>}
      {state && "ok" in state && <p role="status" className="w-full text-slate-600">Uploaded {state.ok}</p>}
    </form>
  );
}
