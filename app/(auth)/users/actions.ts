"use server";

import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/auth/session";
import { createServerClient } from "@/lib/db/client";
import {
  createStaffUser,
  deactivateUser,
  setBillingPerson,
  setUserRole,
  type AdminClient,
  type CreateResult,
  type ManageResult,
} from "@/lib/auth/users";

export type CreateState = CreateResult | null;
export type ManageState = ManageResult | null;

/**
 * Server actions are POSTable on their own, so the admin check runs here, first.
 * The temp password lives only in this action's response — never redirected,
 * cookied, stored, or logged.
 */
export async function createUserAction(_prev: CreateState, formData: FormData): Promise<CreateState> {
  await requireSession("admin");
  return createStaffUser(createServerClient() as unknown as AdminClient, String(formData.get("email") ?? ""));
}

const field = (f: FormData, k: string) => {
  const v = f.get(k);
  return typeof v === "string" ? v : null;
};

function done(r: ManageResult): ManageState {
  if (r.ok) revalidatePath("/users");
  return r;
}

export async function setRoleAction(_prev: ManageState, formData: FormData): Promise<ManageState> {
  await requireSession("admin");
  return done(await setUserRole(createServerClient(), field(formData, "userId"), field(formData, "role")));
}

export async function setBillingPersonAction(_prev: ManageState, formData: FormData): Promise<ManageState> {
  await requireSession("admin");
  return done(await setBillingPerson(createServerClient(), field(formData, "userId"), field(formData, "personid")));
}

export async function deactivateAction(_prev: ManageState, formData: FormData): Promise<ManageState> {
  const session = await requireSession("admin");
  return done(await deactivateUser(createServerClient(), session.userId, field(formData, "userId")));
}
