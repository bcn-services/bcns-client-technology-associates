"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireSession } from "@/lib/auth/session";
import { createServerClient } from "@/lib/db/client";
import { CaseInputError, saveCase, type Db } from "@/lib/cases/record";

/** Save the case record (admin and staff alike). Writes only changed columns; there is no delete action. */
export async function saveCaseAction(id: number, formData: FormData): Promise<void> {
  await requireSession();
  if (!Number.isInteger(id) || id <= 0) throw new Error("invalid case id");
  let q: string;
  try {
    const written = await saveCase(createServerClient() as unknown as Db, id, formData, new Date());
    q = `saved=${Object.keys(written).length ? "1" : "0"}`;
  } catch (e) {
    if (e instanceof CaseInputError) q = `error=${encodeURIComponent(e.message)}`;
    else {
      // Raw DB errors stay in the server log, never on screen.
      console.error(`saveCase ${id}:`, e);
      q = `error=${encodeURIComponent("Save failed; nothing was changed.")}`;
    }
  }
  revalidatePath(`/cases/${id}`);
  redirect(`/cases/${id}?${q}&t=${Date.now()}`);
}
