"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireSession } from "@/lib/auth/session";
import { createServerClient } from "@/lib/db/client";
import type { Db } from "@/lib/time/entries";
import { getConfig } from "@/lib/env";
import { runAddTicket, runCloseTicket, runDeleteTicket, runEditTicket, runReopenTicket, runReviewTicket, sendTicketEmail, type TicketMail } from "@/lib/tickets";

// Any signed-in user (admin or staff) may log and change tickets; only an admin may delete one (runDeleteTicket checks).
const deps = () => ({
  session: () => requireSession(),
  db: () => createServerClient() as unknown as Db,
  revalidatePath,
  redirect,
  notify: (t: TicketMail) => {
    const c = getConfig();
    return sendTicketEmail({ apiKey: c.resendApiKey, apiUrl: c.resendApiUrl, from: c.ticketFromEmail, to: c.ticketNotifyEmail, replyDomain: c.ticketReplyDomain }, t);
  },
});

export async function addTicket(formData: FormData): Promise<void> {
  await runAddTicket(formData, deps());
}

export async function closeTicket(formData: FormData): Promise<void> {
  await runCloseTicket(formData, deps());
}

export async function reopenTicket(formData: FormData): Promise<void> {
  await runReopenTicket(formData, deps());
}

export async function reviewTicket(formData: FormData): Promise<void> {
  await runReviewTicket(formData, deps());
}

export async function editTicket(formData: FormData): Promise<void> {
  await runEditTicket(formData, deps());
}

export async function deleteTicket(formData: FormData): Promise<void> {
  await runDeleteTicket(formData, deps());
}
