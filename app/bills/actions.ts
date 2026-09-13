"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireSession } from "@/lib/auth/session";
import { createServerClient } from "@/lib/db/client";
import type { Db } from "@/lib/time/entries";
import { runEditBill } from "@/lib/bills/edit";
import { runCreateBill } from "@/lib/bills/create";
import { runNoticeAction } from "@/lib/bills/notice";
import { runRevise } from "@/lib/bills/revise";

/** Admin create of one bill on a case, claiming the checked unbilled time rows (see createBill in lib/bills/create.ts). */
export async function createBill(formData: FormData): Promise<void> {
  await runCreateBill(formData, {
    session: () => requireSession("admin"),
    db: () => createServerClient() as unknown as Db,
    revalidatePath,
    redirect,
  });
}

const noticeDeps = () => ({
  session: () => requireSession("admin"),
  db: () => createServerClient() as unknown as Db,
  now: () => new Date(),
  revalidatePath,
  redirect,
});

/** Admin: advance 1st → 2nd → Final, stamping that notice's date (see lib/bills/notice.ts). */
export async function advanceBillNotice(billid: number, formData: FormData): Promise<void> {
  await runNoticeAction("advance", billid, formData, noticeDeps());
}

/** Admin: close an open bill as Cancelled / Carried Over / Deadbeat / Settled (see lib/bills/notice.ts). */
export async function closeBillAs(billid: number, formData: FormData): Promise<void> {
  await runNoticeAction("close", billid, formData, noticeDeps());
}

/** Admin: revise an open, not-yet-revised bill — new bill supersedes it, rows move, old one Cancelled (see lib/bills/revise.ts). */
export async function reviseBillAction(billid: number, formData: FormData): Promise<void> {
  await runRevise(billid, formData, noticeDeps());
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
