"use client";

import { useState } from "react";

/** A legacy scan lives on the office NAS, not in the app: show its file name to copy and look up there. */
export function LegacyFile({ filename }: { filename: string }) {
  const [label, setLabel] = useState("Copy");
  const copy = () => {
    // A refused or missing clipboard says so; the <code> text stays selectable either way.
    const done = (l: string) => { setLabel(l); setTimeout(() => setLabel("Copy"), 1500); };
    (navigator.clipboard?.writeText(filename) ?? Promise.reject()).then(() => done("Copied"), () => done("Select to copy"));
  };
  return (
    <span className="ml-2 inline-flex flex-wrap items-center gap-2">
      <code className="text-sm">{filename}</code>
      <button type="button" onClick={copy} aria-label="Copy file name" className="rounded border border-slate-300 px-2 py-0.5 text-sm hover:bg-slate-100">
        {label}
      </button>
      <span className="text-sm text-slate-500">Stored on the office NAS</span>
    </span>
  );
}
