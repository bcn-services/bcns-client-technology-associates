"use client";

import { clearedDateOnToggle } from "@/lib/funds/save";

/** The funds form's Cleared checkbox: a tick stamps today into Date cleared, an untick blanks it (rule 16). */
export function ClearedBox({ defaultChecked }: { defaultChecked: boolean }) {
  return (
    <label htmlFor="f-cleared" className="flex items-center gap-2 text-sm">
      <input
        id="f-cleared"
        name="cleared"
        type="checkbox"
        defaultChecked={defaultChecked}
        onChange={(e) => {
          const date = e.currentTarget.form?.elements.namedItem("datecleared");
          if (date instanceof HTMLInputElement) date.value = clearedDateOnToggle(e.currentTarget.checked, new Date());
        }}
      />
      Cleared
    </label>
  );
}
