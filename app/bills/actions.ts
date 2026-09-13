"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireSession } from "@/lib/auth/session";
import { createServerClient } from "@/lib/db/client";
import type { Db } from "@/lib/time/entries";
import { runEditBill } from "@/lib/bills/edit";
import { runCreateBill } from "@/lib/bills/create";

/** Admin create of one bill on a case, claiming the checked unbilled time rows (see createBill in lib/bills/create.ts). */
export async function createBill(formData: FormData): Promise<void> {
  await runCreateBill(formData, {
    session: () => requireSession("admin"),
    db: () => createServerClient() as unknown as Db,
    revalidatePath,
    redirect,
  });
}

/** Admin edit-in-place of one bill's six editable columns (see EDITABLE in lib/bills/edit.ts). */
export async function editBill(billid: number, formData: FormData): Promise<void> {
  await runEditBill(billid, formData, {
    session: () => requireSession("admin"),
    db: () => createServerClient() as unknown as Db,
    revalidatePath,
    redirect,
  });
}
