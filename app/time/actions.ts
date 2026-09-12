"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireSession } from "@/lib/auth/session";
import { createServerClient } from "@/lib/db/client";
import { TimeInputError, insertEntry, type Db } from "@/lib/time/entries";

/** Add one time entry for the signed-in person. `actwho` is the session's personId; no form field sets it. */
export async function addEntry(formData: FormData): Promise<void> {
  const session = await requireSession();
  const get = (k: string) => (typeof formData.get(k) === "string" ? String(formData.get(k)) : "");
  const input = { caseId: get("case"), date: get("date"), hours: get("hours"), description: get("description") };
  let code: string | null = null;
  if (session.personId == null) code = "unlinked"; // refused before any DB call; insertEntry refuses too
  else {
    try {
      await insertEntry(createServerClient() as unknown as Db, session, input);
    } catch (e) {
      if (e instanceof TimeInputError) code = e.code;
      else {
        console.error("addEntry:", e); // raw DB text stays in the server log
        code = "failed";
      }
    }
  }
  revalidatePath("/time");
  if (!code) redirect("/time?added=1");
  const q = new URLSearchParams({ error: code, case: input.caseId, date: input.date, hours: input.hours, description: input.description });
  redirect(`/time?${q}`);
}
