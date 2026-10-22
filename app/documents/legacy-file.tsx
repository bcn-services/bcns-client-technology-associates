"use client";

import { useState } from "react";

/** A legacy scan lives on the office NAS, not in the app: show its file name to copy and look up there. */
export function LegacyFile({ filename }: { filename: string }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard.writeText(filename).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }, () => {});
  };
  return (
    <span className="ml-2 inline-flex flex-wrap items-center gap-2">
      <code className="text-sm">{filename}</code>
      <button type="button" onClick={copy} aria-label="Copy file name" className="rounded border border-slate-300 px-2 py-0.5 text-sm hover:bg-slate-100">
        {copied ? "Copied" : "Copy"}
      </button>
      <span className="text-sm text-slate-500">Stored on the office NAS</span>
    </span>
  );
}
