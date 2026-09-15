"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireSession } from "@/lib/auth/session";
import { createServerClient } from "@/lib/db/client";
import type { Db } from "@/lib/time/entries";
import { runImportBank } from "@/lib/bank-import/import";

// Staff and admin may upload; the session check lives inside runImportBank.
export async function importBankAction(formData: FormData): Promise<void> {
  await runImportBank(formData, {
    session: () => requireSession(),
    db: () => createServerClient() as unknown as Db,
    revalidatePath,
    redirect,
  });
}
