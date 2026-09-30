/**
 * Email send core (billing-output item 5; item 6's notice resend reuses it): one message with one PDF attachment through
 * the Resend REST API (plain fetch, no SDK), behind a caller-supplied claim/release guard so a double submit sends once:
 *   0. checkEmail — every caller gets the same refusals: To required, <= 50 per field, valid addresses, subject CR/LF
 *      folded to one line, subject and body non-empty and bounded;
 *   1. claim — the caller's conditional write (e.g. `billsentat` unchanged since the preview rendered); false → stale, no call;
 *   2. POST /emails with Idempotency-Key = <scope>-<sha256 of the payload>. `scope` MUST come from persisted state (e.g.
 *      `bill-<id>-<billsentat before this send>`), never from a per-render token: a retry after a lost answer — same
 *      form, a reloaded page, or another entry point — sends the unchanged payload under the same key, and Resend
 *      (24h window) returns the first result instead of sending twice. An edited payload is a new key;
 *   3. provider refused (4xx other than 409) → release, SendError("provider", <provider's message>): nothing was sent;
 *      no answer (timeout / dropped connection), a 409 (concurrent request on the same key still in flight) or a 5xx
 *      → release, SendError("noanswer", <detail>): it MAY have been sent. Releasing keeps the state the key is scoped
 *      on, so resending unchanged is deduped; the caller must say "may have been sent". If that release itself fails
 *      the code is "noanswer-release" (may have been sent AND still shows as sent), else "release".
 * The claim IS the record: once the provider accepts, nothing else is written, so "sent but not recorded" can't happen.
 * ponytail: after Resend's 24h key window a no-answer resend could double-send — upgrade to a Resend status lookup then.
 */
import { createHash } from "node:crypto";
import type { StorageAdapter } from "@/lib/storage";

export type EmailConfig = { apiKey?: string; apiUrl: string; from?: string };
export type OutgoingEmail = {
  to: string[]; cc: string[]; bcc: string[]; subject: string; text: string;
  attachment: { filename: string; content: Uint8Array };
};
export type SendGuard = { claim: () => Promise<boolean>; release: () => Promise<void> };

export class SendError extends Error {
  constructor(readonly code: string, readonly detail?: string) {
    super(detail ? `${code}: ${detail}` : code);
    this.name = "SendError";
  }
}

/** Both a key and a From address → Send can run; otherwise the preview still works and Send is off. */
export const emailReady = (c: EmailConfig): boolean => !!(c.apiKey && c.from);

const ADDRESS = /^[^\s@<>()[\]\\,;:"]+@[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)+$/;
/** Resend's per-field recipient limit. */
export const MAX_RECIPIENTS = 50;

/** "a@x.test, b@y.test; c@z.test" → addresses; blank → []; any malformed entry (or > 50) → null. */
export function parseAddresses(raw: string): string[] | null {
  const list = raw.split(/[,;\s]+/).filter(Boolean);
  return list.length <= MAX_RECIPIENTS && list.every((a) => a.length <= 254 && ADDRESS.test(a)) ? list : null;
}

/** Store bytes at `key` (upsert: overwrites only that key). */
export async function writeStoredFile(storage: StorageAdapter | null, key: string, bytes: Uint8Array): Promise<void> {
  if (!storage) throw new SendError("storage");
  await storage.putFile(key, bytes, "application/pdf");
}

/** A stored object's bytes (via a short signed URL, as the PDF download route does). */
export async function readStoredFile(storage: StorageAdapter | null, key: string): Promise<Uint8Array> {
  if (!storage) throw new SendError("storage");
  const res = await fetch(await storage.getSignedUrl(key, 60), { cache: "no-store", signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new Error(`storage fetch ${res.status}`);
  return new Uint8Array(await res.arrayBuffer());
}

const providerMessage = async (res: Response): Promise<string> => {
  const raw = await res.text().catch(() => "");
  let msg = raw;
  try { msg = (JSON.parse(raw) as { message?: string }).message ?? raw; } catch { /* not JSON: keep the text */ }
  return `${res.status} ${msg}`.trim().slice(0, 300);
};

export const MAX_SUBJECT = 998, MAX_BODY = 50_000;
type Message = Omit<OutgoingEmail, "attachment">;

/** The shared refusals (SendError code to/cc/bcc/subject/body); returns the message with its subject on one line. */
export function checkEmail<T extends Message>(e: T): T {
  const fields = { to: e.to, cc: e.cc, bcc: e.bcc };
  for (const [code, list] of Object.entries(fields)) {
    if (list.length > MAX_RECIPIENTS || !list.every((a) => a.length <= 254 && ADDRESS.test(a))) throw new SendError(code);
  }
  if (!e.to.length) throw new SendError("to");
  const subject = e.subject.replace(/[\r\n]+/g, " ").trim();
  if (!subject || subject.length > MAX_SUBJECT) throw new SendError("subject");
  if (!e.text.trim() || e.text.length > MAX_BODY) throw new SendError("body");
  return { ...e, subject };
}

/**
 * Check, claim, send, release on failure. Returns the provider's message id. `scope` is the idempotency scope from
 * persisted state (see the header); `fetchFn` is injectable for tests (they point `apiUrl` at a local stub either way).
 */
export async function sendWithGuard(
  cfg: EmailConfig, email: OutgoingEmail, guard: SendGuard, scope: string, fetchFn: typeof fetch = fetch,
): Promise<string> {
  if (!emailReady(cfg)) throw new SendError("email-off");
  const m = checkEmail(email);
  const body = JSON.stringify({
    from: cfg.from, to: m.to, cc: m.cc, bcc: m.bcc, subject: m.subject, text: m.text,
    attachments: [{ filename: m.attachment.filename, content: Buffer.from(m.attachment.content).toString("base64") }],
  });
  const key = `${scope}-${createHash("sha256").update(body).digest("hex").slice(0, 32)}`.slice(-256);
  if (!(await guard.claim())) throw new SendError("stale");
  let failure: SendError;
  try {
    const res = await fetchFn(`${cfg.apiUrl.replace(/\/+$/, "")}/emails`, {
      method: "POST",
      headers: { authorization: `Bearer ${cfg.apiKey}`, "content-type": "application/json", "idempotency-key": key },
      body,
      signal: AbortSignal.timeout(30_000),
    });
    if (res.ok) {
      const json = (await res.json().catch(() => ({}))) as { id?: string };
      return json.id ?? "";
    }
    // 409 = a request with this key is still in flight; 5xx = the service failed mid-way. Either may have gone out.
    failure = new SendError(res.status === 409 || res.status >= 500 ? "noanswer" : "provider", await providerMessage(res));
  } catch (e) {
    console.error("send: no answer from the email service, key", key, e);
    failure = new SendError("noanswer", e instanceof Error ? e.message : String(e));
  }
  try {
    await guard.release();
  } catch (e) {
    console.error("send release failed after a provider failure:", e);
    throw new SendError(failure.code === "noanswer" ? "noanswer-release" : "release", failure.detail);
  }
  throw failure;
}
