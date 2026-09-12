import { addEntry } from "./actions";

export type EntryValues = { case: string; date: string; hours: string; description: string };

const input = "rounded border border-slate-300 px-2 py-1";

/** Plain server-rendered form posting to the addEntry action; `values` re-fill it after a refusal. */
export function EntryForm({ values, error }: { values: EntryValues; error?: string }) {
  return (
    <form action={addEntry} className="max-w-xl space-y-3">
      {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
      <div className="grid gap-3 sm:grid-cols-3">
        <label htmlFor="t-case" className="grid gap-1 text-sm">
          Case
          <input id="t-case" name="case" inputMode="numeric" pattern="\d{1,9}" defaultValue={values.case} required className={input} />
        </label>
        <label htmlFor="t-date" className="grid gap-1 text-sm">
          Date
          <input id="t-date" name="date" type="date" defaultValue={values.date} required className={input} />
        </label>
        <label htmlFor="t-hours" className="grid gap-1 text-sm">
          Hours
          <input id="t-hours" name="hours" type="number" step="0.125" min="0.125" max="24" defaultValue={values.hours} required className={input} />
        </label>
      </div>
      <label htmlFor="t-description" className="grid gap-1 text-sm">
        Description
        <textarea id="t-description" name="description" rows={3} defaultValue={values.description} required className={input} />
      </label>
      <button type="submit" className="rounded border border-slate-300 bg-slate-800 px-3 py-1 text-sm text-white hover:bg-slate-700">
        Add entry
      </button>
    </form>
  );
}
