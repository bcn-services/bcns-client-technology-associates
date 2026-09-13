"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireSession } from "@/lib/auth/session";
import { createServerClient } from "@/lib/db/client";
import type { Db } from "@/lib/time/entries";
import { runEditBill } from "@/lib/bills/edit";

/** Admin edit-in-place of one bill's six editable columns (see EDITABLE in lib/bills/edit.ts). */
export async function editBill(billid: number, formData: FormData): Promise<void> {
  await runEditBill(billid, formData, {
    session: () => requireSession("admin"),
    db: () => createServerClient() as unknown as Db,
    revalidatePath,
    redirect,
  });
}
