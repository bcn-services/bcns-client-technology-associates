import type { ExpType } from "@/lib/expenses/types";
import { expenseErrorMessage, type ExpenseForm as Values } from "@/lib/expenses/save";

type Person = { personid: number; initials: string };
type Props = {
  action: (formData: FormData) => Promise<void>;
  values: Values;
  types: ExpType[]; // active only (listActiveTypes); `keepType` adds the row's current retired type on edit
  keepType?: number | null;
  people: Person[];
  error: string;
};

const FIELD_CODES = new Set(["date", "dscr", "checknum", "type", "amount", "case", "bill", "init", "datecleared", "scanned", "notcounted"]);
const input = "w-full rounded border px-2 py-1 text-sm";

/** One form for /expenses/new and /expenses/[id]; a field-level code shows beside its field. */
export function ExpenseForm({ action, values: v, types, keepType, people, error }: Props) {
  const fieldErr = FIELD_CODES.has(error) ? error : "";
  const Err = ({ code }: { code: string }) =>
    fieldErr === code ? <p id={`${code}-error`} role="alert" className="text-xs text-red-700">{expenseErrorMessage(code)}</p> : null;
  const aria = (code: string) => (fieldErr === code ? { "aria-invalid": true, "aria-describedby": `${code}-error` } : {});
  const retired = keepType != null && !types.some((t) => t.exptypeid === keepType);
  const F = ({ name, label, children }: { name: string; label: string; children: React.ReactNode }) => (
    <div className="space-y-1">
      <label htmlFor={name} className="block text-sm font-medium">{label}</label>
      {children}
      <Err code={name} />
    </div>
  );
  return (
    // Keyed per render: a same-URL redirect must remount the form so uncontrolled inputs take the new values.
    <form key={Date.now()} action={action} className="grid gap-3 sm:grid-cols-2">
      {error && !fieldErr && <p role="alert" className="text-sm text-red-700 sm:col-span-2">{expenseErrorMessage(error)}</p>}
      <F name="date" label="Date"><input id="date" name="date" type="date" required defaultValue={v.date} className={input} {...aria("date")} /></F>
      <F name="checknum" label="Check number"><input id="checknum" name="checknum" inputMode="numeric" required pattern="\d+" defaultValue={v.checknum} className={input} {...aria("checknum")} /></F>
      <F name="dscr" label="Description"><input id="dscr" name="dscr" required defaultValue={v.dscr} className={input} {...aria("dscr")} /></F>
      <F name="amount" label="Amount"><input id="amount" name="amount" inputMode="decimal" required defaultValue={v.amount} className={input} {...aria("amount")} /></F>
      <F name="type" label="Type">
        <select id="type" name="type" defaultValue={v.type} className={input} {...aria("type")}>
          <option value="">(none)</option>
          {types.map((t) => <option key={t.exptypeid} value={t.exptypeid}>{t.exptype}</option>)}
          {retired && <option value={keepType!}>Type #{keepType} (retired)</option>}
        </select>
      </F>
      <F name="branch" label="Branch"><input id="branch" name="branch" defaultValue={v.branch} className={input} /></F>
      <F name="case" label="Case (blank = firm-wide)"><input id="case" name="case" inputMode="numeric" defaultValue={v.case} className={input} {...aria("case")} /></F>
      <F name="bill" label="Bill"><input id="bill" name="bill" inputMode="numeric" defaultValue={v.bill} className={input} {...aria("bill")} /></F>
      <F name="init" label="Initials">
        <select id="init" name="init" defaultValue={v.init} className={input} {...aria("init")}>
          <option value="">(none)</option>
          {people.map((p) => <option key={p.personid} value={p.personid}>{p.initials}</option>)}
        </select>
      </F>
      <F name="reason" label="Reason"><input id="reason" name="reason" defaultValue={v.reason} className={input} /></F>
      <div className="flex items-center gap-2">
        <input id="cleared" name="cleared" type="checkbox" defaultChecked={v.cleared === "on" || v.cleared === "true"} />
        <label htmlFor="cleared" className="text-sm font-medium">Cleared bank</label>
      </div>
      <F name="datecleared" label="Date cleared"><input id="datecleared" name="datecleared" type="date" defaultValue={v.datecleared} className={input} {...aria("datecleared")} /></F>
      <F name="bankaccount" label="Bank account"><input id="bankaccount" name="bankaccount" defaultValue={v.bankaccount} className={input} /></F>
      <F name="scanned" label="Scanned check number"><input id="scanned" name="scanned" inputMode="numeric" defaultValue={v.scanned} className={input} {...aria("scanned")} /></F>
      <F name="clearingnotes" label="Clearing notes"><textarea id="clearingnotes" name="clearingnotes" defaultValue={v.clearingnotes} className={input} /></F>
      <F name="notcounted" label="Not counted in profit"><input id="notcounted" name="notcounted" inputMode="decimal" defaultValue={v.notcounted} className={input} {...aria("notcounted")} /></F>
      <div className="sm:col-span-2"><button className="rounded bg-slate-800 px-3 py-1 text-sm text-white">Save expense</button></div>
    </form>
  );
}
