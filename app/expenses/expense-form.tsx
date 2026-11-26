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
  /** New Expense only (ticket 14): show just the 8 fields the client uses. Edit keeps all 16 so a save never blanks a hidden one. */
  compact?: boolean;
};

const FIELD_CODES = new Set(["date", "dscr", "checknum", "type", "amount", "case", "bill", "init", "datecleared", "scanned", "notcounted"]);
const input = "w-full rounded border px-2 py-1 text-sm";

/** One form for /expenses/new and /expenses/[id]; a field-level code shows beside its field. */
export function ExpenseForm({ action, values: v, types, keepType, people, error, compact }: Props) {
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
  const f_date = (
    <F name="date" label="Date"><input id="date" name="date" type="date" required defaultValue={v.date} className={input} {...aria("date")} /></F>
  );
  const f_checknum = (
    <F name="checknum" label="Check number"><input id="checknum" name="checknum" inputMode="numeric" required pattern="\d+" defaultValue={v.checknum} className={input} {...aria("checknum")} /></F>
  );
  const f_dscr = (
    <F name="dscr" label="Description"><input id="dscr" name="dscr" required defaultValue={v.dscr} className={input} {...aria("dscr")} /></F>
  );
  const f_amount = (
    <F name="amount" label="Amount"><input id="amount" name="amount" inputMode="decimal" required defaultValue={v.amount} className={input} {...aria("amount")} /></F>
  );
  const f_type = (
    <F name="type" label="Type">
      <select id="type" name="type" defaultValue={v.type} className={input} {...aria("type")}>
        <option value="">(none)</option>
        {types.map((t) => <option key={t.exptypeid} value={t.exptypeid}>{t.exptype}</option>)}
        {retired && <option value={keepType!}>Type #{keepType} (retired)</option>}
      </select>
    </F>
  );
  const f_branch = (
    <F name="branch" label="Branch"><input id="branch" name="branch" defaultValue={v.branch} className={input} /></F>
  );
  const f_case = (
    <F name="case" label="Case"><input id="case" name="case" placeholder="blank = firm-wide" inputMode="numeric" defaultValue={v.case} className={input} {...aria("case")} /></F>
  );
  const f_bill = (
    <F name="bill" label="Bill"><input id="bill" name="bill" inputMode="numeric" defaultValue={v.bill} className={input} {...aria("bill")} /></F>
  );
  const f_init = (
    <F name="init" label="Initials">
      <select id="init" name="init" defaultValue={v.init} className={input} {...aria("init")}>
        <option value="">(none)</option>
        {people.map((p) => <option key={p.personid} value={p.personid}>{p.initials}</option>)}
      </select>
    </F>
  );
  const f_reason = (
    <F name="reason" label="Reason"><input id="reason" name="reason" defaultValue={v.reason} className={input} /></F>
  );
  const f_cleared = (
    <div className="flex items-center gap-2">
      <input id="cleared" name="cleared" type="checkbox" defaultChecked={v.cleared === "on" || v.cleared === "true"} />
      <label htmlFor="cleared" className="text-sm font-medium">Cleared bank</label>
        </div>
  );
  const f_datecleared = (
    <F name="datecleared" label="Date cleared"><input id="datecleared" name="datecleared" type="date" defaultValue={v.datecleared} className={input} {...aria("datecleared")} /></F>
  );
  const f_bankaccount = (
    <F name="bankaccount" label="Bank account"><input id="bankaccount" name="bankaccount" defaultValue={v.bankaccount} className={input} /></F>
  );
  const f_scanned = (
    <F name="scanned" label="Scanned check number"><input id="scanned" name="scanned" inputMode="numeric" defaultValue={v.scanned} className={input} {...aria("scanned")} /></F>
  );
  const f_clearingnotes = (
    <F name="clearingnotes" label="Clearing notes"><textarea id="clearingnotes" name="clearingnotes" defaultValue={v.clearingnotes} className={input} /></F>
  );
  const f_notcounted = (
    <F name="notcounted" label="Not counted in profit"><input id="notcounted" name="notcounted" inputMode="decimal" defaultValue={v.notcounted} className={input} {...aria("notcounted")} /></F>
  );
  return (
    // Keyed per render: a same-URL redirect must remount the form so uncontrolled inputs take the new values.
    <form key={Date.now()} action={action} className="grid gap-3 sm:grid-cols-2">
      {error && !fieldErr && <p role="alert" className="text-sm text-red-700 sm:col-span-2">{expenseErrorMessage(error)}</p>}
      {compact ? <>{f_case}{f_date}{f_dscr}{f_checknum}{f_type}{f_amount}{f_reason}{f_notcounted}</> : <>{f_date}{f_checknum}{f_dscr}{f_amount}{f_type}{f_branch}{f_case}{f_bill}{f_init}{f_reason}{f_cleared}{f_datecleared}{f_bankaccount}{f_scanned}{f_clearingnotes}{f_notcounted}</>}
      <div className="sm:col-span-2"><button className="rounded bg-slate-800 px-3 py-1 text-sm text-white">Save expense</button></div>
    </form>
  );
}
