import Link from "next/link";
import { notFound } from "next/navigation";
import { randomUUID } from "node:crypto";
import { requireSession } from "@/lib/auth/session";
import { createServerClient } from "@/lib/db/client";
import type { Db } from "@/lib/time/entries";
import { getConfig } from "@/lib/env";
import { emailReady } from "@/lib/bill-docs/send";
import { noticeKey } from "@/lib/bill-docs/notice";
import { loadSend, noticeBlockCode, noticeEmailDraft, sendErrorMessage } from "@/lib/bills/send";
import { finalizedOn } from "@/lib/bills/finalize-model";
import { sendNoticeAction } from "../../actions";
import { SendForm } from "../send/send-form";

export const dynamic = "force-dynamic";

type Params = Record<string, string | string[] | undefined>;
const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

/**
 * Send notice (2nd / Final): the legacy notice email pre-filled and editable, the stamped PDF linked (rendered from the
 * stored invoice on view, no write), Send for admins once email is configured. Sending never changes the notice or its
 * dates — advancing stays the bill page's Advance action.
 */
export default async function NoticePage({ params, searchParams }: { params: { id: string }; searchParams: Params }) {
  const session = await requireSession();
  if (!/^\d{1,9}$/.test(params.id)) notFound();
  const id = Number(params.id);
  const data = await loadSend(createServerClient() as unknown as Db, id);
  if (!data) notFound();
  const { bill } = data;
  const cfg = getConfig();
  const emailOn = emailReady({ apiKey: cfg.resendApiKey, apiUrl: cfg.resendApiUrl, from: cfg.billFromEmail });
  const sent = first(searchParams.sent) === "1";
  return (
    <main className="mx-auto max-w-3xl space-y-4 px-4 py-6">
      <h1 className="text-xl font-semibold">Send {bill.billnotice} notice — bill #{id}</h1>
      <p className="text-sm">
        <Link href={`/bills/${id}`} className="underline">Back to bill #{id}</Link>
        {` · Case ${bill.billcaseid}${data.casetitle ? `: ${data.casetitle}` : ""} · ${bill.billdate}`}
      </p>
      {bill.billsentat && (
        <p role="status" data-testid="bill-sent" className="rounded border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-900">
          {`${sent ? "Notice sent" : "Last emailed"} ${finalizedOn(bill.billsentat)} to ${bill.billsentto ?? ""}`}
        </p>
      )}
      {!data.noticeable ? (
        <p data-testid="notice-blocked" className="text-sm text-slate-600">{sendErrorMessage(noticeBlockCode(bill))}</p>
      ) : session.role !== "admin" ? (
        <p className="text-sm text-slate-600">{sendErrorMessage("forbidden")}</p>
      ) : sent ? (
        <p><Link href={`/bills/${id}/notice`} data-testid="send-again" className="inline-block rounded border border-slate-300 px-3 py-1 text-sm">Send again</Link></p>
      ) : (
        <SendForm
          draft={noticeEmailDraft(data, cfg.noticeBccEmail)}
          alert={data.billingalert}
          emailOn={emailOn}
          token={randomUUID()}
          sentat={bill.billsentat ?? ""}
          notice={bill.billnotice}
          pdfHref={`/bills/${id}/notice/pdf`}
          pdfName={noticeKey(bill.billpdfpath!, bill.billnotice).split("/").pop()!}
          action={sendNoticeAction.bind(null, id)}
        />
      )}
    </main>
  );
}
