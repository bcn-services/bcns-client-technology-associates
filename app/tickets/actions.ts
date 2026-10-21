"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireSession } from "@/lib/auth/session";
import { createServerClient } from "@/lib/db/client";
import type { Db } from "@/lib/time/entries";
import { runAddTicket, runCloseTicket, runReopenTicket } from "@/lib/tickets";

// Any signed-in user (admin or staff) may log and change tickets.
const deps = () => ({
  session: () => requireSession(),
  db: () => createServerClient() as unknown as Db,
  revalidatePath,
  redirect,
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
