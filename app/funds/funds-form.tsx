import { CaseInput } from "./case-input";
import { FUNDS_TYPES, fundsErrorMessage, type FundsValues } from "@/lib/funds/save";

const input = "rounded border border-slate-300 px-2 py-1";

/** Error text rendered next to the field it belongs to; codes without a field show above the form. */
const FIELD_CODES = new Set(["case", "amount", "date", "datecleared"]);

function FieldError({ code, field }: { code?: string; field: string }) {
  if (code !== field) return null;
  return <span id={`f-${field}-error`} role="alert" className="text-sm text-red-700">{fundsErrorMessage(code)}</span>;
}

/**
 * Plain server-rendered funds form, used by /funds/new and /funds/[id].
 * Callers wrap it in a host element with a fresh `key` per render: Next 14 keys every page segment as `__PAGE__`
 * (search params ignored), so an action redirect back to the same page reuses the uncontrolled inputs. A key on
 * this server component itself is dropped from the RSC payload and does nothing.
 */
export function FundsForm({ values, error, action, submitLabel, bill, prefill }: {
  values: FundsValues;
  error?: string;
  action: (formData: FormData) => void | Promise<void>;
  submitLabel: string;
  /** /funds/new only: the bill to preselect on the saved funds page; carried, never written to the funds row. */
  bill?: string;
  /** /funds/new only: typing a case number fills an empty Attorney/Description. */
  prefill?: boolean;
}) {
  const caseField = (
    <label htmlFor="f-case" className="grid gap-1 text-sm">
      Case
      <CaseInput id="f-case" name="case" defaultValue={values.case} aria-invalid={error === "case" || undefined}
        aria-describedby={error === "case" ? "f-case-error" : undefined} className={input} inputMode="numeric" required fillOnBlur={prefill} />
      <FieldError code={error} field="case" />
    </label>
  );
  const text = (name: keyof FundsValues, label: string, extra: React.InputHTMLAttributes<HTMLInputElement> = {}) => (
    <label htmlFor={`f-${name}`} className="grid gap-1 text-sm">
      {label}
      <input id={`f-${name}`} name={name} defaultValue={values[name]} aria-invalid={error === name || undefined}
        aria-describedby={error === name ? `f-${name}-error` : undefined} className={input} {...extra} />
      <FieldError code={error} field={name} />
    </label>
  );
  // Branch, bank account and the clearing fields are off the form (ticket 9) but still round-trip: an edit must not blank them.
  const keep = (["branch", "bankaccount", "cleared", "datecleared", "clearingnotes"] as const).map((k) => (
    <input key={k} type="hidden" name={k} defaultValue={values[k]} />
  ));
  return (
    <form action={action} className="max-w-3xl space-y-3">
      {bill && <input type="hidden" name="bill" value={bill} />}
      {error && !FIELD_CODES.has(error) && <p role="alert" className="text-sm text-red-700">{fundsErrorMessage(error)}</p>}
      <div className="grid gap-3 sm:grid-cols-3">
        {caseField}
        {text("amount", "Amount", { inputMode: "decimal", required: true, placeholder: "450.00" })}
        {text("date", "Date", { type: "date", required: true })}
        {text("payee", "Payee")}
        {text("source", "Attorney")}
        {text("type", "Type", { list: "f-type-options", autoComplete: "off" })}
        <datalist id="f-type-options">{FUNDS_TYPES.map((t) => <option key={t} value={t} />)}</datalist>
      </div>
      <label htmlFor="f-description" className="grid gap-1 text-sm">
        Description
        <textarea id="f-description" name="description" rows={2} defaultValue={values.description} className={input} />
      </label>
      <label htmlFor="f-comment" className="grid gap-1 text-sm">
        Comment
        <textarea id="f-comment" name="comment" rows={2} defaultValue={values.comment} className={input} />
      </label>
      {keep}
      <button type="submit" className="rounded border border-slate-300 bg-slate-800 px-3 py-1 text-sm text-white hover:bg-slate-700">
        {submitLabel}
      </button>
    </form>
  );
}
