/**
 * Email send core (billing-output item 5; item 6's notice resend reuses it): one message with one PDF attachment through
 * the Resend REST API (plain fetch, no SDK), behind a caller-supplied claim/release guard so a double submit sends once:
 *   1. claim — the caller's conditional write (e.g. `billsentat` unchanged since the preview rendered); false → stale, no call;
 *   2. POST /emails with an Idempotency-Key (preview token + payload hash: a same-preview retry is deduped by Resend, an
 *      edited retry is a new key);
 *   3. any provider failure → release (undo the claim) and throw SendError("provider", <provider's message>).
 * The claim IS the record: once the provider accepts, nothing else is written, so "sent but not recorded" can't happen.
 * ponytail: a provider timeout after Resend actually accepted is released as a failure (guardrail: never mark sent on a
 * failure); the Idempotency-Key makes the same-preview retry safe — upgrade to a Resend status lookup if that ever bites.
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

/** A stored object's bytes (via a short signed URL, as the PDF download route does). */
export async function readStoredFile(storage: StorageAdapter | null, key: string): Promise<Uint8Array> {
  if (!storage) throw new SendError("storage");
  const res = await fetch(await storage.getSignedUrl(key, 60), { cache: "no-store" });
  if (!res.ok) throw new Error(`storage fetch ${res.status}`);
  return new Uint8Array(await res.arrayBuffer());
}

const providerMessage = async (res: Response): Promise<string> => {
  const raw = await res.text().catch(() => "");
  let msg = raw;
  try { msg = (JSON.parse(raw) as { message?: string }).message ?? raw; } catch { /* not JSON: keep the text */ }
  return `${res.status} ${msg}`.trim().slice(0, 300);
};

/**
 * Validate, claim, send, release on failure. Returns the provider's message id. `token` is the per-preview token the
 * page rendered; `fetchFn` is injectable for tests (they point `apiUrl` at a local stub either way).
 */
export async function sendWithGuard(
  cfg: EmailConfig, email: OutgoingEmail, guard: SendGuard, token: string, fetchFn: typeof fetch = fetch,
): Promise<string> {
  if (!emailReady(cfg)) throw new SendError("email-off");
  if (!email.to.length || ![...email.to, ...email.cc, ...email.bcc].every((a) => ADDRESS.test(a))) throw new SendError("to");
  const body = JSON.stringify({
    from: cfg.from, to: email.to, cc: email.cc, bcc: email.bcc, subject: email.subject, text: email.text,
    attachments: [{ filename: email.attachment.filename, content: Buffer.from(email.attachment.content).toString("base64") }],
  });
  const key = `${token}-${createHash("sha256").update(body).digest("hex").slice(0, 32)}`.slice(0, 256);
  if (!(await guard.claim())) throw new SendError("stale");
  let failure: string;
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
    failure = await providerMessage(res);
  } catch (e) {
    failure = `no answer from the email service (${e instanceof Error ? e.message : String(e)})`;
  }
  try {
    await guard.release();
  } catch (e) {
    console.error("send release failed after a provider failure:", e);
    throw new SendError("release", failure);
  }
  throw new SendError("provider", failure);
}
