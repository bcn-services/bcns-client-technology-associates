"use server";

import { redirect } from "next/navigation";
import { requireSession } from "@/lib/auth/session";
import { createServerClient } from "@/lib/db/client";
import { createInquiry, updateInquiry } from "@/lib/inquiries/inquiries";

export type FormState = { error: string } | null;

// Server actions are POSTable on their own, so the session check runs here, first.
export async function createInquiryAction(_prev: FormState, fd: FormData): Promise<FormState> {
  await requireSession();
  const r = await createInquiry(createServerClient(), fd);
  if (!r.ok) return { error: r.error };
  redirect(`/inquiries/${r.id}?created=1`);
}

export async function updateInquiryAction(_prev: FormState, fd: FormData): Promise<FormState> {
  await requireSession();
  const id = Number(fd.get("id"));
  if (!Number.isInteger(id) || id <= 0) return { error: "Missing inquiry id." };
  const r = await updateInquiry(createServerClient(), id, fd);
  if (!r.ok) return { error: r.error };
  redirect(`/inquiries/${id}?saved=1`);
}
