"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { Db as CaseDb } from "@/lib/cases/record";
import { convertInquiry } from "@/lib/inquiries/convert";
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

/** Inquiry → case; on success land on the new case's record. Separate form from the edit form. */
export async function convertInquiryAction(_prev: FormState, fd: FormData): Promise<FormState> {
  await requireSession();
  const id = Number(fd.get("inquiryId"));
  if (!Number.isInteger(id) || id <= 0) return { error: "Missing inquiry id." };
  const r = await convertInquiry(createServerClient() as unknown as CaseDb, id, fd, new Date());
  if (!r.ok) return { error: r.error };
  revalidatePath("/cases");
  revalidatePath(`/inquiries/${id}`);
  redirect(`/cases/${r.id}`);
}

export async function updateInquiryAction(_prev: FormState, fd: FormData): Promise<FormState> {
  await requireSession();
  const id = Number(fd.get("id"));
  if (!Number.isInteger(id) || id <= 0) return { error: "Missing inquiry id." };
  const r = await updateInquiry(createServerClient(), id, fd);
  if (!r.ok) return { error: r.error };
  redirect(`/inquiries/${id}?saved=1`);
}
