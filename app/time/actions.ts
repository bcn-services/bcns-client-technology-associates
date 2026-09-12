"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireSession } from "@/lib/auth/session";
import { createServerClient } from "@/lib/db/client";
import { TimeInputError, insertEntry, updateEntry as updateRow, deleteEntry as deleteRow, type Db } from "@/lib/time/entries";

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

/** Maps a lib refusal to its code; anything else is logged and becomes "failed". */
function codeOf(e: unknown, where: string): string {
  if (e instanceof TimeInputError) return e.code;
  console.error(`${where}:`, e);
  return "failed";
}

/** Edit an unbilled row (own, or any if admin). Only case/date/hours/description are read from the form. */
export async function updateEntry(actid: number, formData: FormData): Promise<void> {
  const session = await requireSession();
  const get = (k: string) => (typeof formData.get(k) === "string" ? String(formData.get(k)) : "");
  const input = { caseId: get("case"), date: get("date"), hours: get("hours"), description: get("description") };
  const orig = { caseId: get("case__orig"), date: get("date__orig"), hours: get("hours__orig"), description: get("description__orig") };
  let code: string | null = null;
  let week = "";
  if (session.personId == null) code = "unlinked"; // refused before any DB call; updateRow refuses too
  else if (!Number.isSafeInteger(actid) || actid <= 0) code = "locked";
  else {
    try {
      week = await updateRow(createServerClient() as unknown as Db, session, actid, { ...input, orig });
    } catch (e) {
      code = codeOf(e, "updateEntry");
    }
  }
  revalidatePath("/time");
  revalidatePath(`/time/${actid}`);
  if (!code) redirect(`/time?${new URLSearchParams({ week, saved: "1" })}`);
  const q = new URLSearchParams({ error: code, case: input.caseId, date: input.date, hours: input.hours, description: input.description });
  redirect(`/time/${actid}?${q}`);
}

/** Delete an unbilled row (own, or any if admin). Plain form POST, no confirm step. */
export async function deleteEntry(actid: number): Promise<void> {
  const session = await requireSession();
  let code: string | null = null;
  let week = "";
  if (session.personId == null) code = "unlinked"; // refused before any DB call; deleteRow refuses too
  else if (!Number.isSafeInteger(actid) || actid <= 0) code = "locked";
  else {
    try {
      week = await deleteRow(createServerClient() as unknown as Db, session, actid);
    } catch (e) {
      code = codeOf(e, "deleteEntry");
    }
  }
  revalidatePath("/time");
  if (!code) redirect(`/time?${new URLSearchParams({ week, deleted: "1" })}`);
  redirect(`/time/${actid}?error=${code}`);
}
