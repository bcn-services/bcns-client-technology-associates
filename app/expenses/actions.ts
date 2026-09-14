"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireSession } from "@/lib/auth/session";
import { createServerClient } from "@/lib/db/client";
import type { Db } from "@/lib/time/entries";
import { runAddType, runReactivateType, runRetireType } from "@/lib/expenses/types";

// The admin check lives inside the run* body (lib/expenses/types.ts), so plain requireSession() here.
const typeDeps = () => ({
  session: () => requireSession(),
  db: () => createServerClient() as unknown as Db,
  revalidatePath,
  redirect,
});

/** Admin: add an active expense type. */
export async function addExpenseType(formData: FormData): Promise<void> {
  await runAddType(formData, typeDeps());
}

/** Admin: retire a type (active=false). Expenses keep their exptype. */
export async function retireExpenseType(formData: FormData): Promise<void> {
  await runRetireType(formData, typeDeps());
}

/** Admin: reactivate a retired (or legacy null) type. */
export async function reactivateExpenseType(formData: FormData): Promise<void> {
  await runReactivateType(formData, typeDeps());
}
