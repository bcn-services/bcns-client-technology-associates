"use client";

import { useState } from "react";
import { useFormStatus } from "react-dom";

/**
 * Disabled while its form's action runs (a server action shows nothing on its own, so a slow round trip read as a dead
 * click). Only the clicked button says "Saving…": the row form holds both Close and Reopen.
 */
export function SubmitButton({ label, formAction, className }: { label: string; formAction?: (formData: FormData) => Promise<void>; className: string }) {
  const { pending } = useFormStatus();
  const [clicked, setClicked] = useState(false);
  if (!pending && clicked) setClicked(false); // an action that settles without the usual remount must not leave "Saving…" armed
  return (
    <button formAction={formAction} disabled={pending} onClick={() => setClicked(true)} className={`${className} disabled:opacity-60`}>
      {pending && clicked ? "Saving…" : label}
    </button>
  );
}
