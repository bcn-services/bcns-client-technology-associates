import Link from "next/link";
import { SaSubmit } from "@/app/cases/[id]/sa-submit";
import { BILL_TYPES } from "@/lib/bills/rules";
import { fmtMoney, type BillPageData } from "@/lib/bills/edit";
import { fmtHours, thousandths } from "@/lib/time/week";

const DASH = "—";
const show = (v: string | number | null | undefined) => (v == null || v === "" ? DASH : String(v));
const input = "rounded border border-slate-300 px-2 py-1";

/** Pure view of one bill. `action` is the bound editBill; passed only for admins, so staff get no form. */
export function BillView({ data, admin, action, error, saved }: {
  data: BillPageData;
  admin: boolean;
  action?: (formData: FormData) => void | Promise<void>;
  error?: string;
  saved?: boolean;
}) {
  const { bill: b, casetitle, activity, revisedBy } = data;
  const fields: [string, React.ReactNode][] = [
    ["Case", <Link key="c" href={`/cases/${b.billcaseid}`} className="underline">{`Case ${b.billcaseid}${casetitle ? `: ${casetitle}` : ""}`}</Link>],
    ["Bill date", b.billdate],
    ["Type", show(b.billtype)],
    ["Status", b.billnotice],
    ["Balance", fmtMoney(b.billbalance)],
    ["Hours", Number(b.billhours).toFixed(2)],
    ["Estimate", b.billestimate ? "Yes" : "No"],
    ["2nd notice", show(b.billsecondnoticedate)],
    ["Final notice", show(b.billfinalnoticedate)],
    ["Paid", show(b.billpaiddate)],
    ["Reports", show(b.billreports)],
    ["Priority", show(b.billpriority)],
    ["File name", show(b.billfilename)],
    ["Comments", show(b.billcomments)],
  ];
  // Remount the form whenever the row changes, so a same-URL redirect shows the saved values (Next 14.2 keeps uncontrolled inputs).
  const formKey = JSON.stringify([b.billdate, b.billtype, b.billbalance, b.billestimate, b.billcomments, b.billfilename]);
  return (
    <div className="space-y-4">
      {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
      {saved && !error && <p role="status" className="text-sm text-green-700">Bill updated</p>}
      <dl data-testid="bill-fields" className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1 text-sm">
        {fields.map(([k, v]) => (
          <div key={k} className="contents">
            <dt className="text-slate-500">{k}</dt>
            <dd data-field={k}>{v}</dd>
          </div>
        ))}
      </dl>
      {(b.supersedesbillid != null || revisedBy.length > 0) && (
        <p className="flex flex-wrap gap-3 text-sm">
          {b.supersedesbillid != null && <Link href={`/bills/${b.supersedesbillid}`} className="underline">Revises #{b.supersedesbillid}</Link>}
          {revisedBy.map((k) => <Link key={k} href={`/bills/${k}`} className="underline">Revised by #{k}</Link>)}
        </p>
      )}
      <section className="space-y-2">
        <h2 className="font-semibold">Time on this bill</h2>
        {activity.length === 0 ? (
          <p className="text-sm text-slate-500">No time entries attached</p>
        ) : (
          <table className="text-sm">
            <thead><tr className="text-left text-slate-500"><th className="pr-4">Date</th><th className="pr-4">Who</th><th className="pr-4">Description</th><th className="text-right">Hours</th></tr></thead>
            <tbody>
              {activity.map((a) => (
                <tr key={a.actid} data-testid="bill-activity">
                  <td className="pr-4">{a.actdate}</td>
                  <td className="pr-4">{a.initials || DASH}</td>
                  <td className="pr-4">{a.actdescription}</td>
                  <td className="text-right tabular-nums">{fmtHours(thousandths(a.acthrs))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
      {admin && action && (
        <form key={formKey} action={action} data-testid="bill-edit" className="max-w-xl space-y-3 rounded border border-slate-200 p-3">
          <h2 className="font-semibold">Edit bill</h2>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="grid gap-1 text-sm">Bill date
              <input name="billdate" type="date" required defaultValue={b.billdate} className={input} />
            </label>
            <label className="grid gap-1 text-sm">Bill type
              <select name="billtype" defaultValue={b.billtype ?? ""} className={input}>
                <option value="">{DASH}</option>
                {BILL_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </label>
            <label className="grid gap-1 text-sm">Balance
              <input name="billbalance" inputMode="decimal" required pattern="-?[0-9,]{1,13}(\.[0-9]{1,2})?" defaultValue={fmtMoney(b.billbalance)} className={input} />
            </label>
            <label className="grid gap-1 text-sm">File name
              <input name="billfilename" defaultValue={b.billfilename ?? ""} className={input} />
            </label>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input name="billestimate" type="checkbox" defaultChecked={!!b.billestimate} /> Estimate
          </label>
          <label className="grid gap-1 text-sm">Comments
            <textarea name="billcomments" rows={3} defaultValue={b.billcomments ?? ""} className={input} />
          </label>
          <SaSubmit label="Update bill" />
        </form>
      )}
    </div>
  );
}
