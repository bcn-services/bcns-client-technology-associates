"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireSession } from "@/lib/auth/session";
import { createServerClient } from "@/lib/db/client";
import { returnWith, safeReturnTo } from "@/lib/cases/create";
import { SPECS, ContactInputError, createContact, parseForm, parseOrigRow, updateContact, type Db, type Kind } from "./contacts";

/** Create (id null) or edit one firm / attorney / client. Admin and staff alike. No delete action exists. */
export async function saveContact(kind: Kind, id: number | null, formData: FormData): Promise<void> {
  await requireSession();
  const spec = SPECS[kind];
  if (!spec) throw new Error("unknown contact kind");
  // From /cases/new "Add attorney/client": after create, go back there with the new row selected.
  const returnTo = id === null && (kind === "attorney" || kind === "client") ? safeReturnTo(formData.get("returnTo")) : null;
  const back = `${spec.path}/${id ?? "new"}`;
  let target: string;
  try {
    const db = createServerClient() as unknown as Db;
    const payload = parseForm(kind, formData);
    const saved = id === null ? await createContact(db, kind, payload) : (await updateContact(db, kind, id, payload, parseOrigRow(formData.get("__orig"))), id);
    target = returnTo ? returnWith(returnTo, kind, saved) : `${spec.path}/${saved}?saved=${id === null ? "created" : "saved"}`;
  } catch (e) {
    if (!(e instanceof ContactInputError)) throw e;
    target = `${back}?error=${encodeURIComponent(e.message)}${returnTo ? `&returnTo=${encodeURIComponent(returnTo)}` : ""}`;
  }
  revalidatePath(spec.path);
  redirect(target);
}
