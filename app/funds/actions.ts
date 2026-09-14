"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireSession } from "@/lib/auth/session";
import { createServerClient } from "@/lib/db/client";
import type { Db } from "@/lib/time/entries";
import { runCreateFunds, runUpdateFunds } from "@/lib/funds/save";

// Staff and admin may record/edit funds; the session check lives inside the run* body (lib/funds/save.ts).
const deps = () => ({
  session: () => requireSession(),
  db: () => createServerClient() as unknown as Db,
  revalidatePath,
  redirect,
});

export async function createFundsAction(formData: FormData): Promise<void> {
  await runCreateFunds(formData, deps());
}

export async function updateFundsAction(fndsid: number, formData: FormData): Promise<void> {
  await runUpdateFunds(fndsid, formData, deps());
}
