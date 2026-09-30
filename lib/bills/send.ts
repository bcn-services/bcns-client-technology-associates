/**
 * Preview-then-Send for one finalized bill (billing-output item 5). The page renders an editable preview (loadSend +
 * billEmailDraft) with a per-preview token and the `billsentat` it saw; the action (runSend) re-checks everything on
 * the server — admin, email configured, canSendBill, the recipient-alert tick, addresses — then sends through the
 * shared core (lib/bill-docs/send.ts) guarded by a claim on `billsentat` unchanged since the preview:
 *   claim  = update tblbills set billsentat = <now>, billsentto = <To> where billid and billsentat = <rendered> (and
 *            finalize stamp / PDF / notice as loaded); 0 rows → stale, no provider call (a double submit sends once);
 *   release (provider failed or no answer) = restore both columns, guarded on our own stamp.
 * Idempotency scope = `bill-<id>-<billsentat before this send>`: an unchanged resend after a no-answer (same form, a
 * reload, or "Email this bill") reuses the Resend key, so it can't send twice; the render token only guards staleness.
 *
 * Notice resend (item 6) is the same action with kind "notice": canSendNotice instead of canSendBill, the preview's
 * notice must still be the bill's, the attachment is the stored PDF stamped and saved beside it (lib/bill-docs/notice.ts),
 * and the scope is `notice-<SecondNotice|FinalNotice>-<id>-<billsentat before>`. It claims the same two columns —
 * billsentat / billsentto mean "last emailed" (bill or notice) — and never writes billnotice or the notice dates.
 */
import type { Db } from "@/lib/time/entries";
import type { Session } from "@/lib/auth/session";
import { brokenFinalize, storedLines } from "./finalize";
import { NOTICE_STAMPS, canSendBill, canSendNotice, isNoticeStage } from "./rules";
import { SendError, checkEmail, emailReady, parseAddresses, sendWithGuard, type EmailConfig } from "@/lib/bill-docs/send";
import { saveNoticePdf } from "@/lib/bill-docs/notice";

export type SendBill = {
  billid: number; billcaseid: number; billdate: string; billtype: string | null; billhours: number | string;
  billbalance: number | string; billnotice: string; billfinalizedat: string | null; billfilename: string | null;
  billpdfpath: string | null; billsentat: string | null; billsentto: string | null;
};
export type SendData = {
  bill: SendBill;
  casetitle: string | null;
  casecaption: string | null;
  billingalert: boolean;
  billingcc: string | null;
  attyemail: string | null;
  attyLastName: string;
  broken: boolean;
  /** canSendBill: typed, finalized, PDF stored, lines intact, not closed. */
  sendable: boolean;
  /** canSendNotice: at 2nd or Final, typed, finalized, PDF stored. */
  noticeable: boolean;
};
export type EmailDraft = { to: string; cc: string; bcc: string; subject: string; body: string };

export async function loadSend(db: Db, billid: number): Promise<SendData | null> {
  const b = await db.from("tblbills")
    .select("billid, billcaseid, billdate, billtype, billhours, billbalance, billnotice, billfinalizedat, billfilename, billpdfpath, billsentat, billsentto")
    .eq("billid", billid).maybeSingle();
  if (b.error) throw new Error(`tblbills read: ${b.error.message}`);
  if (!b.data) return null;
  const bill = b.data as SendBill;
  const [k, lines] = await Promise.all([
    db.from("tblcase").select("casetitle, casecaption, caseatty, billingalert, billingcc").eq("caseid", bill.billcaseid).maybeSingle(),
    bill.billfinalizedat ? storedLines(db, billid) : [],
  ]);
  if (k.error) throw new Error(`tblcase read: ${k.error.message}`);
  const a = k.data?.caseatty != null
    ? await db.from("tblattorney").select("attyemail, attylastname").eq("attyid", k.data.caseatty).maybeSingle() : null;
  if (a?.error) throw new Error(`tblattorney read: ${a.error.message}`);
  const broken = brokenFinalize(bill, lines);
  return {
    bill,
    casetitle: k.data?.casetitle ?? null,
    casecaption: k.data?.casecaption ?? null,
    billingalert: k.data?.billingalert === true,
    billingcc: k.data?.billingcc ?? null,
    attyemail: a?.data?.attyemail ?? null,
    attyLastName: a?.data?.attylastname ?? "",
    broken,
    sendable: canSendBill(bill, broken),
    noticeable: canSendNotice(bill),
  };
}

const subjectFor = (d: SendData) => `Re: ${d.casecaption?.trim() || d.casetitle?.trim() || ""}`;

/** The legacy bill email, pre-filled: To attorney, CC BILL_CC_EMAIL + the case's billingcc, "Re: <caption>". */
export function billEmailDraft(d: SendData, billCcEmail: string | undefined): EmailDraft {
  return {
    to: d.attyemail?.trim() ?? "",
    cc: [billCcEmail, d.billingcc?.trim()].filter(Boolean).join(", "),
    bcc: "",
    subject: subjectFor(d),
    body: `Atty. ${d.attyLastName},\n\nPlease see the attached invoice for the recent work on this case. Let me know if you have any questions.  Thank you.`,
  };
}

/**
 * The legacy notice email (Form_frmBillUnpaid Email_Click), pre-filled: To attorney, CC the case's billingcc, BCC
 * NOTICE_BCC_EMAIL, "Re: <caption>"; Final adds the USPS line. Line breaks as the VBA's vbCrLf, in \n.
 */
export function noticeEmailDraft(d: SendData, noticeBccEmail: string | undefined): EmailDraft {
  return {
    to: d.attyemail?.trim() ?? "",
    cc: d.billingcc?.trim() ?? "",
    bcc: noticeBccEmail?.trim() ?? "",
    subject: subjectFor(d),
    body: `Dear Atty. ${d.attyLastName},\n\nAttached is a copy of an invoice that is past due in the subject matter.\n`
      + (d.bill.billnotice === "Final" ? "A copy has also been mailed via USPS.\n" : "")
      + "\nPlease contact us if there are any questions.\n\nThank you,",
  };
}

/** Why a notice can't be sent (canSendNotice false) — for the bill page, the unpaid list, the notice page and the action. */
export function noticeBlockCode(b: { billtype: string | null; billnotice: string }): string {
  if (!isNoticeStage(b.billnotice)) return "notice-stage";
  return b.billtype === null ? "notice-legacy" : "notice-nopdf";
}

/** Why the bill can't be sent (canSendBill false), for the page and the action. */
export function sendBlockCode(d: SendData): string {
  if (d.bill.billtype === null) return "legacy";
  if (!d.bill.billfinalizedat) return "unfinalized";
  if (d.broken) return "broken";
  if (!d.bill.billpdfpath) return "nopdf";
  return "closed";
}

const MESSAGES: Record<string, string> = {
  forbidden: "Only admins can send bills.",
  notfound: "That bill does not exist.",
  "email-off": "Email is not set up yet, so Send is turned off. The preview and the PDF still work.",
  legacy: "This is a legacy bill: it has no bill type, so it can't be emailed from here.",
  unfinalized: "Finalize this bill before sending it.",
  broken: "This bill's saved lines are missing — use Revise to rebuild it before sending.",
  nopdf: "This bill has no invoice PDF yet — create it on the bill page first.",
  closed: "This bill is closed (cancelled, carried over, settled or revised), so it can't be sent.",
  alert: "This case has a bill recipient alert — tick the box to confirm you checked the recipients.",
  to: "Enter at least one valid To address (separate several with commas).",
  cc: "One of the CC addresses is not a valid email address.",
  bcc: "One of the BCC addresses is not a valid email address.",
  subject: "The subject can't be empty.",
  body: "The message can't be empty.",
  stale: "This bill changed since the preview opened (it may already have been sent). Nothing was sent — reload the page.",
  storage: "File storage is not configured, so the PDF can't be attached. Nothing was sent.",
  provider: "The email service refused the message. Nothing was sent and the bill is not marked sent.",
  noanswer: "The email service didn't answer — it may have been sent. The bill is not marked sent. Check before sending again; resending it unchanged (same To, CC, BCC, subject and message, within 24 hours) will not send twice.",
  "noanswer-release": "The email service didn't answer — it may have been sent, and the bill shows as sent. Check before sending again.",
  "notice-stage": "A notice can only be sent for a bill at 2nd or Final.",
  "notice-legacy": "This is a legacy bill with no stored invoice PDF, so its notice can't be sent from here.",
  "notice-nopdf": "This bill has no stored invoice PDF, so there is no notice to send — finalize it and create its PDF first.",
  "notice-key": "Another bill's PDF already uses this notice's file name, so nothing was sent.",
  release: "The send did not complete, and the bill's sent status could not be restored — reload and check its sent status before sending again.",
  failed: "The bill could not be sent. Nothing was recorded.",
};
export const sendErrorMessage = (code: string): string => MESSAGES[code] ?? MESSAGES.failed!;

export type SendState = { code: string; message: string } | null;
export type SendDeps = {
  session: () => Promise<Session>;
  db: () => Db;
  now: () => Date;
  config: () => EmailConfig;
  readPdf: (key: string) => Promise<Uint8Array>;
  /** Saves the stamped notice PDF (kind "notice" only). */
  writePdf?: (key: string, bytes: Uint8Array) => Promise<void>;
  fetch?: typeof fetch;
  revalidatePath: (p: string) => void;
  redirect: (url: string) => never;
};

const fail = (code: string, detail?: string): SendState =>
  ({ code, message: detail ? `${sendErrorMessage(code)} (${detail})` : sendErrorMessage(code) });

export type SendKind = "bill" | "notice";

/**
 * Body of the send and send-notice server actions (useFormState). Every refusal returns a state and calls nothing
 * external; success revalidates and redirects to /bills/<id>/send?sent=1 (notice: /notice?sent=1), outside the try so
 * NEXT_REDIRECT is never swallowed.
 */
export async function runSend(billid: number, formData: FormData, deps: SendDeps, kind: SendKind = "bill"): Promise<SendState> {
  try {
    await deps.session();
  } catch (e) {
    if (e instanceof Error && e.name === "ForbiddenError") return fail("forbidden");
    throw e;
  }
  if (!Number.isSafeInteger(billid) || billid <= 0) return fail("notfound");
  const cfg = deps.config();
  if (!emailReady(cfg)) return fail("email-off");
  const get = (k: string) => (typeof formData.get(k) === "string" ? String(formData.get(k)) : "");
  try {
    const db = deps.db();
    const d = await loadSend(db, billid);
    if (!d) return fail("notfound");
    const notice = kind === "notice";
    if (notice ? !d.noticeable : !d.sendable) return fail(notice ? noticeBlockCode(d.bill) : sendBlockCode(d));
    const { bill } = d;
    if (d.billingalert && get("alertok") !== "1") return fail("alert");
    const token = get("token");
    if (!/^[0-9a-f-]{36}$/.test(token) || get("sentat") !== (bill.billsentat ?? "")) return fail("stale");
    if (notice && get("notice") !== bill.billnotice) return fail("stale"); // advanced since the preview: other stamp and body
    const to = parseAddresses(get("to")), cc = parseAddresses(get("cc")), bcc = parseAddresses(get("bcc"));
    if (!to?.length) return fail("to");
    if (!cc) return fail("cc");
    if (!bcc) return fail("bcc");
    const msg = checkEmail({ to, cc, bcc, subject: get("subject"), text: get("body") }); // refuses before the PDF read

    const attachment = notice
      ? await saveNoticePdf(db, { billid, billpdfpath: bill.billpdfpath!, billnotice: bill.billnotice }, deps.readPdf,
        deps.writePdf ?? (() => Promise.reject(new SendError("storage"))))
      : { filename: bill.billpdfpath!.slice(bill.billpdfpath!.lastIndexOf("/") + 1), content: await deps.readPdf(bill.billpdfpath!) };
    const stamp = deps.now().toISOString();
    const sentto = to.join(", ");
    const claimQ = db.from("tblbills").update({ billsentat: stamp, billsentto: sentto })
      .eq("billid", billid).eq("billfinalizedat", bill.billfinalizedat!).eq("billpdfpath", bill.billpdfpath!).eq("billnotice", bill.billnotice);
    const release = async () => {
      const r = await db.from("tblbills").update({ billsentat: bill.billsentat, billsentto: bill.billsentto })
        .eq("billid", billid).eq("billsentat", stamp).select("billid");
      if (r.error) throw new Error(`tblbills send release: ${r.error.message}`);
    };
    await sendWithGuard(cfg, { ...msg, attachment }, {
      claim: async () => {
        const c = await (bill.billsentat === null ? claimQ.is("billsentat", null) : claimQ.eq("billsentat", bill.billsentat)).select("billid");
        if (c.error) {
          // The reply can be lost after the claim committed: undo it (a no-op if it never landed), then refuse.
          try {
            await release();
          } catch (e) {
            console.error("send claim-error release failed:", billid, e);
            throw new SendError("release", c.error.message); // the claim may have stuck: "reload and check", not "nothing recorded"
          }
          throw new Error(`tblbills send claim: ${c.error.message}`);
        }
        return (c.data ?? []).length === 1;
      },
      release,
    }, `${notice ? `notice-${NOTICE_STAMPS[bill.billnotice]}` : "bill"}-${billid}-${bill.billsentat ?? "none"}`, deps.fetch);
  } catch (e) {
    if (e instanceof SendError) return fail(e.code, e.detail);
    console.error("sendBill:", billid, e);
    return fail("failed");
  }
  deps.revalidatePath(`/bills/${billid}`);
  deps.redirect(`/bills/${billid}/${kind === "notice" ? "notice" : "send"}?sent=1`);
}
