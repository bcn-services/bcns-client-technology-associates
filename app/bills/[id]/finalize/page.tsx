import Link from "next/link";
import { notFound } from "next/navigation";
import { requireSession } from "@/lib/auth/session";
import { createServerClient } from "@/lib/db/client";
import type { Db } from "@/lib/time/entries";
import { loadFinalize } from "@/lib/bills/finalize";
import { finalizeErrorMessage, finalizedOn, hoursText, initialValues } from "@/lib/bills/finalize-model";
import { finalizeBillAction } from "../../actions";
import { RecipientAlert } from "../../recipient-alert";
import { FinalizeForm } from "./finalize-form";
import { LinesTable } from "./lines-table";

export const dynamic = "force-dynamic";

type Params = Record<string, string | string[] | undefined>;
const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
const warn = "rounded border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900";

/**
 * Finalize one typed bill: rate per person (timesheet) or the editable estimate, a live total, one Save.
 * A finalized bill shows its STORED lines read-only (never a re-pricing); legacy bills and staff get no form.
 */
export default async function FinalizePage({ params, searchParams }: { params: { id: string }; searchParams: Params }) {
  const session = await requireSession();
  if (!/^\d{1,9}$/.test(params.id)) notFound();
  const id = Number(params.id);
  const data = await loadFinalize(createServerClient() as unknown as Db, id);
  if (!data) notFound();
  const admin = session.role === "admin";
  const error = first(searchParams.error);
  const { bill, base } = data;
  return (
    <main className="mx-auto max-w-4xl space-y-4 px-4 py-6">
      <h1 className="text-xl font-semibold">Finalize bill #{id}</h1>
      <p className="text-sm">
        <Link href={`/bills/${id}`} className="underline">Back to bill #{id}</Link>
        {data.casetitle ? ` · Case ${bill.billcaseid}: ${data.casetitle}` : ` · Case ${bill.billcaseid}`}
        {bill.billtype ? ` · ${bill.billtype}` : ""} · {bill.billdate}
      </p>
      {error && <p role="alert" className="text-sm text-red-700">{finalizeErrorMessage(error)}</p>}
      <RecipientAlert alert={data.billingalert} cc={data.billingcc} />
      {data.warnings.map((w) => (
        <p key={w.personid} role="alert" data-testid="finalize-warning" className={warn}>
          {`Person #${w.personid} has no billing name — their ${hoursText(w.hours)} hrs are billed at the standard rate with no person.`}
        </p>
      ))}
      {data.empty && <p data-testid="finalize-empty" className={warn}>Nothing to bill — this timesheet bill has no time entries.</p>}
      {bill.billtype === null ? (
        <p className="text-sm text-slate-600">This is a legacy bill: it has no bill type, so there is nothing to finalize.</p>
      ) : bill.billfinalizedat ? (
        <section className="space-y-2">
          <p data-testid="finalize-locked" className="text-sm">
            Finalized {finalizedOn(bill.billfinalizedat)}. These are the saved lines; changes go through Revise on the bill page.
          </p>
          <LinesTable lines={data.stored} testid="finalize-stored" />
        </section>
      ) : !admin ? (
        <p className="text-sm text-slate-600">Only admins can finalize bills.</p>
      ) : (
        <FinalizeForm
          base={base!}
          initial={initialValues(base!, new Map(data.prior))}
          initials={data.initials}
          fingerprint={data.fingerprint}
          action={finalizeBillAction.bind(null, id)}
        />
      )}
    </main>
  );
}
