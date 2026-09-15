"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireSession } from "@/lib/auth/session";
import { createServerClient } from "@/lib/db/client";
import type { Db } from "@/lib/time/entries";
import { runImportBank } from "@/lib/bank-import/import";
import { runConfirmTransaction } from "@/lib/bank-import/confirm";
import { runClearRows } from "@/lib/bank-import/clearing";

// Staff and admin may confirm; the session check lives inside runConfirmTransaction.
export async function confirmTransactionAction(formData: FormData): Promise<void> {
  await runConfirmTransaction(formData, {
    session: () => requireSession(),
    db: () => createServerClient() as unknown as Db,
    revalidatePath,
    redirect,
  });
}

// Staff and admin may clear; the session check and the account-guarded writes live inside runClearRows.
export async function clearRowsAction(formData: FormData): Promise<void> {
  await runClearRows(formData, {
    session: () => requireSession(),
    db: () => createServerClient() as unknown as Db,
    revalidatePath,
    redirect,
  });
}

// Staff and admin may upload; the session check lives inside runImportBank.
export async function importBankAction(formData: FormData): Promise<void> {
  await runImportBank(formData, {
    session: () => requireSession(),
    db: () => createServerClient() as unknown as Db,
    revalidatePath,
    redirect,
  });
}
