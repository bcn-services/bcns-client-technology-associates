import { addEntry } from "./actions";

export type EntryValues = { case: string; date: string; hours: string; description: string };

const input = "rounded border border-slate-300 px-2 py-1";

/**
 * Plain server-rendered form; `values` re-fill it after a refusal. Defaults to the /time add form.
 * /time/[id] passes `action` (bound updateEntry), `submitLabel` "Save" and `orig` (the row as
 * rendered → hidden `<name>__orig` inputs the update diffs against), or `readOnly` for a billed row.
 */
export function EntryForm({ values, error, action = addEntry, submitLabel = "Add entry", orig, readOnly = false }: {
  values: EntryValues;
  error?: string;
  action?: (formData: FormData) => void | Promise<void>;
  submitLabel?: string;
  orig?: EntryValues;
  readOnly?: boolean;
}) {
  return (
    <form action={action} className="max-w-xl space-y-3">
      {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
      {orig && (Object.keys(orig) as (keyof EntryValues)[]).map((k) => <input key={k} type="hidden" name={`${k}__orig`} value={orig[k]} />)}
      <fieldset disabled={readOnly} className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-3">
          <label htmlFor="t-case" className="grid gap-1 text-sm">
            Case
            <input id="t-case" name="case" inputMode="numeric" pattern="\d{1,9}" defaultValue={values.case} required readOnly={readOnly} className={input} />
          </label>
          <label htmlFor="t-date" className="grid gap-1 text-sm">
            Date
            <input id="t-date" name="date" type="date" defaultValue={values.date} required readOnly={readOnly} className={input} />
          </label>
          <label htmlFor="t-hours" className="grid gap-1 text-sm">
            Hours
            <input id="t-hours" name="hours" type="number" step="0.001" min="0.001" max="24" defaultValue={values.hours} required readOnly={readOnly} className={input} />
          </label>
        </div>
        <label htmlFor="t-description" className="grid gap-1 text-sm">
          Description
          <textarea id="t-description" name="description" rows={3} defaultValue={values.description} required readOnly={readOnly} className={input} />
        </label>
      </fieldset>
      {!readOnly && (
        <button type="submit" className="rounded border border-slate-300 bg-slate-800 px-3 py-1 text-sm text-white hover:bg-slate-700">
          {submitLabel}
        </button>
      )}
    </form>
  );
}
