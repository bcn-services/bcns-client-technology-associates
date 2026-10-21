// Inbound ticket replies: Nate replies to a ticket email, Resend posts `email.received` here, the ticket moves to In review.
// The route (app/api/tickets/inbound) is a thin adapter; everything testable lives here with fetch, db and clock injected.
import { createHmac, timingSafeEqual } from "node:crypto";
import type { Db } from "@/lib/time/entries";
import { addMessage } from "@/lib/tickets";

const TOLERANCE_S = 300;
const MAX_BODY = 5_000;

export type SvixHeaders = { id: string | null; timestamp: string | null; signature: string | null };

/**
 * Svix webhook signature (what Resend sends): HMAC-SHA256 over `${id}.${timestamp}.${rawBody}` keyed by the base64 part of
 * the `whsec_` secret; the header is space-separated `v1,<base64>` entries and any one may match. Unset secret, missing
 * headers, a malformed or stale (> 5 min either way) timestamp all reject.
 */
export function verifySvix(secret: string | undefined, h: SvixHeaders, rawBody: string, nowMs: number): boolean {
  if (!secret || !h.id || !h.timestamp || !h.signature) return false;
  if (!/^\d{1,12}$/.test(h.timestamp) || Math.abs(nowMs / 1000 - Number(h.timestamp)) > TOLERANCE_S) return false;
  const key = Buffer.from(secret.replace(/^whsec_/, ""), "base64");
  const expected = createHmac("sha256", key).update(`${h.id}.${h.timestamp}.${rawBody}`).digest();
  return h.signature.split(" ").some((entry) => {
    const [version, sig] = entry.split(",");
    if (version !== "v1" || !sig) return false;
    const got = Buffer.from(sig, "base64");
    return got.length === expected.length && timingSafeEqual(got, expected);
  });
}

/** `Name <a@b.test>` or `a@b.test` -> `a@b.test`, lowercased. */
export const bareAddress = (from: string): string => (/<([^<>]+)>\s*$/.exec(from)?.[1] ?? from).trim().toLowerCase();

/** Ticket id from the first `t<id>@<domain>` address on the reply domain; null when none. */
export function ticketIdFrom(addresses: string[], domain: string): number | null {
  for (const a of addresses) {
    const m = /^t(\d{1,9})@(.+)$/i.exec(bareAddress(a));
    if (m && m[2] === domain.toLowerCase() && Number(m[1]) > 0) return Number(m[1]);
  }
  return null;
}

/** Keep only what the sender typed: cut at the first quote marker. */
// ponytail: naive quote strip — a line starting `>` or an `On ... wrote:` header (up to two lines) — upgrade when a client mangles it.
export function stripQuoted(text: string): string {
  const cuts = [/^On [^\n]*(?:\n[^\n]*)?\bwrote:\s*$/m, /^\s*>/m, /^-{2,}\s*Original Message\s*-{2,}/im]
    .map((re) => re.exec(text)?.index)
    .filter((i): i is number => i !== undefined);
  return (cuts.length ? text.slice(0, Math.min(...cuts)) : text).trim();
}

const stripTags = (html: string) =>
  html.replace(/<(?:style|script)[\s\S]*?<\/(?:style|script)>/gi, "").replace(/<br\s*\/?>|<\/(?:p|div)>/gi, "\n").replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/g, " ").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, "&");

export type InboundDeps = {
  secret?: string;
  /** Only mail from this bare address counts (TICKET_NOTIFY_EMAIL). */
  notifyEmail?: string;
  replyDomain?: string;
  apiKey?: string;
  apiUrl: string;
  db: () => Db;
  fetchFn?: typeof fetch;
  now?: () => number;
};
export type InboundResult = { status: 200 | 401 | 500; note: string };

type Mail = { from?: unknown; to?: unknown; received_for?: unknown };
const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);

/** The ticket this mail is a reply for, or null when the sender or recipient isn't ours. */
function target(m: Mail, d: InboundDeps): number | null {
  if (!d.notifyEmail || !d.replyDomain || typeof m.from !== "string") return null;
  if (bareAddress(m.from) !== d.notifyEmail.toLowerCase()) return null;
  return ticketIdFrom([...strings(m.to), ...strings(m.received_for)], d.replyDomain);
}

/**
 * Full inbound pipeline. 401 only for a bad signature; 500 for a transient failure (Resend retries); 200 for everything
 * else, ignored or duplicate deliveries included, so Resend stops retrying.
 */
export async function handleInbound(rawBody: string, headers: SvixHeaders, d: InboundDeps): Promise<InboundResult> {
  const now = (d.now ?? Date.now)();
  if (!verifySvix(d.secret, headers, rawBody, now)) return { status: 401, note: "bad signature" };

  let event: { type?: unknown; data?: Mail & { email_id?: unknown } };
  try {
    event = JSON.parse(rawBody);
  } catch {
    return { status: 200, note: "ignored: not json" };
  }
  if (event?.type !== "email.received") return { status: 200, note: "ignored: event type" };
  const emailId = event.data?.email_id;
  if (typeof emailId !== "string" || !emailId) return { status: 200, note: "ignored: no email_id" };
  if (target(event.data ?? {}, d) === null) return { status: 200, note: "ignored: sender or recipient" }; // saves the fetch for strangers

  if (!d.apiKey) return { status: 500, note: "RESEND_API_KEY missing" };
  let mail: Mail & { text?: unknown; html?: unknown; authentication?: { dmarc?: unknown; dkim?: unknown } | null };
  try {
    const res = await (d.fetchFn ?? fetch)(`${d.apiUrl.replace(/\/+$/, "")}/emails/receiving/${encodeURIComponent(emailId)}`, {
      headers: { authorization: `Bearer ${d.apiKey}` },
      signal: AbortSignal.timeout(8_000),
    });
    if (!res.ok) return { status: 500, note: `fetch answered ${res.status}` };
    mail = await res.json();
  } catch (e) {
    return { status: 500, note: `fetch failed: ${e instanceof Error ? e.message : "error"}` };
  }

  // The sender address is spoofable; the receiving server's verdict is the proof. DMARC pass (or DKIM pass, which Resend
  // only reports as pass when the signing domain matches From) must be present; a missing authentication field rejects.
  const auth = mail.authentication;
  if (!auth || (auth.dmarc !== "pass" && auth.dkim !== "pass")) return { status: 200, note: "ignored: not authenticated" };
  const ticketId = target(mail, d);
  if (ticketId === null) return { status: 200, note: "ignored: sender or recipient" };

  const body = stripQuoted(typeof mail.text === "string" && mail.text.trim() ? mail.text : stripTags(typeof mail.html === "string" ? mail.html : "")).slice(0, MAX_BODY).trim();
  if (!body) return { status: 200, note: "ignored: empty reply" };

  try {
    const db = d.db();
    const found = await db.from("tickets").select("id").eq("id", ticketId);
    if (found.error) throw found.error;
    if (!found.data?.length) return { status: 200, note: "ignored: no such ticket" };
    try {
      await addMessage(db, ticketId, "email", body, emailId);
    } catch (e) {
      if ((e as { code?: string })?.code === "23505") return { status: 200, note: "duplicate" }; // unique resend_email_id: a retry
      throw e;
    }
    // A reply means Nate wants it reviewed, whatever the status was (a Closed ticket included).
    const upd = await db.from("tickets").update({ status: "In review" }).eq("id", ticketId);
    if (upd.error) throw upd.error;
  } catch (e) {
    return { status: 500, note: `db failed: ${e instanceof Error ? e.message : (e as { message?: string })?.message ?? "error"}` };
  }
  return { status: 200, note: `ticket ${ticketId} in review` };
}
