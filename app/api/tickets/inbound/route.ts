/**
 * /api/tickets/inbound — Resend `email.received` webhook: Nate's reply to a ticket email moves the ticket to In review.
 * Public in middleware.ts (no session); the Svix signature in lib/tickets-inbound.ts is the only gate, and it fails closed.
 * 401 on a bad signature, 500 on a transient failure (Resend retries), 200 otherwise.
 */
import { getConfig } from "@/lib/env";
import { createServerClient } from "@/lib/db/client";
import type { Db } from "@/lib/time/entries";
import { handleInbound } from "@/lib/tickets-inbound";

export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  const c = getConfig();
  const rawBody = await request.text(); // raw: the signature covers the exact bytes
  const result = await handleInbound(
    rawBody,
    { id: request.headers.get("svix-id"), timestamp: request.headers.get("svix-timestamp"), signature: request.headers.get("svix-signature") },
    {
      secret: c.ticketInboundSecret,
      notifyEmail: c.ticketNotifyEmail,
      replyDomain: c.ticketReplyDomain,
      apiKey: c.resendApiKey,
      apiUrl: c.resendApiUrl,
      db: () => createServerClient() as unknown as Db,
    },
  );
  if (result.status !== 200 || !result.note.startsWith("ignored")) console.log(`ticket inbound: ${result.status} ${result.note}`);
  return new Response(result.note, { status: result.status });
}
