import Link from "next/link";
import { notFound } from "next/navigation";
import { randomUUID } from "node:crypto";
import { requireSession } from "@/lib/auth/session";
import { createServerClient } from "@/lib/db/client";
import type { Db } from "@/lib/time/entries";
import { getConfig } from "@/lib/env";
import { emailReady } from "@/lib/bill-docs/send";
import { billEmailDraft, loadSend, sendBlockCode, sendErrorMessage } from "@/lib/bills/send";
import { finalizedOn } from "@/lib/bills/finalize-model";
import { sendBillAction } from "../../actions";
import { SendForm } from "./send-form";

export const dynamic = "force-dynamic";

type Params = Record<string, string | string[] | undefined>;
const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

/**
 * Preview-then-Send: the legacy bill email pre-filled and editable, the PDF linked, Send for admins once email is
 * configured and any recipient alert is ticked. A sent bill shows "Sent <date> to <addr>" and offers Send again.
 */
export default async function SendPage({ params, searchParams }: { params: { id: string }; searchParams: Params }) {
  const session = await requireSession();
  if (!/^\d{1,9}$/.test(params.id)) notFound();
  const id = Number(params.id);
  const data = await loadSend(createServerClient() as unknown as Db, id);
  if (!data) notFound();
  const { bill } = data;
  const admin = session.role === "admin";
  const cfg = getConfig();
  const emailOn = emailReady({ apiKey: cfg.resendApiKey, apiUrl: cfg.resendApiUrl, from: cfg.billFromEmail });
  const again = first(searchParams.again) === "1";
  const file = bill.billpdfpath?.slice(bill.billpdfpath.lastIndexOf("/") + 1);
  return (
    <main className="mx-auto max-w-3xl space-y-4 px-4 py-6">
      <h1 className="text-xl font-semibold">Send bill #{id}</h1>
      <p className="text-sm">
        <Link href={`/bills/${id}`} className="underline">Back to bill #{id}</Link>
        {` · Case ${bill.billcaseid}${data.casetitle ? `: ${data.casetitle}` : ""} · ${bill.billdate}`}
      </p>
      {bill.billsentat && (
        <p role="status" data-testid="bill-sent" className="rounded border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-900">
          {`Sent ${finalizedOn(bill.billsentat)} to ${bill.billsentto ?? ""}`}
        </p>
      )}
      {!data.sendable ? (
        <p data-testid="send-blocked" className="text-sm text-slate-600">{sendErrorMessage(sendBlockCode(data))}</p>
      ) : !admin ? (
        <p className="text-sm text-slate-600">{sendErrorMessage("forbidden")}</p>
      ) : bill.billsentat && !again ? (
        <p><Link href={`/bills/${id}/send?again=1`} data-testid="send-again" className="inline-block rounded border border-slate-300 px-3 py-1 text-sm">Send again</Link></p>
      ) : (
        <SendForm
          draft={billEmailDraft(data, cfg.billCcEmail)}
          alert={data.billingalert}
          emailOn={emailOn}
          token={randomUUID()}
          sentat={bill.billsentat ?? ""}
          pdfHref={`/bills/${id}/pdf`}
          pdfName={file!}
          action={sendBillAction.bind(null, id)}
        />
      )}
    </main>
  );
}
