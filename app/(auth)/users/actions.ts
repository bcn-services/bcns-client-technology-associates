"use server";

import { requireSession } from "@/lib/auth/session";
import { createServerClient } from "@/lib/db/client";
import { createStaffUser, type AdminClient, type CreateResult } from "@/lib/auth/users";

export type CreateState = CreateResult | null;

/**
 * Server actions are POSTable on their own, so the admin check runs here, first.
 * The temp password lives only in this action's response — never redirected,
 * cookied, stored, or logged.
 */
export async function createUserAction(_prev: CreateState, formData: FormData): Promise<CreateState> {
  await requireSession("admin");
  return createStaffUser(createServerClient() as unknown as AdminClient, String(formData.get("email") ?? ""));
}
