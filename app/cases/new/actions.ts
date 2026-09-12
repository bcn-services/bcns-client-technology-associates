"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireSession } from "@/lib/auth/session";
import { createServerClient } from "@/lib/db/client";
import { createCase } from "@/lib/cases/create";
import type { Db } from "@/lib/cases/record";

export type NewCaseState = { error: string } | null;

/** Create a case with the explicit case number (admin and staff alike); on success land on its record. */
export async function createCaseAction(_prev: NewCaseState, formData: FormData): Promise<NewCaseState> {
  await requireSession();
  const res = await createCase(createServerClient() as unknown as Db, formData);
  if (!res.ok) return { error: res.error };
  revalidatePath("/cases");
  redirect(`/cases/${res.id}`);
}
