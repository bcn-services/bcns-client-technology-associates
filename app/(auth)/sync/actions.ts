"use server";

import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/auth/session";
import { createServerClient, requestActor } from "@/lib/db/client";
import { onlyForbidden } from "@/lib/auth/users";
import { getConfig } from "@/lib/env";
import { requestSync, type SyncResult } from "@/lib/sync/runs";

export type SyncActionState = SyncResult | null;

/** Server actions are POSTable on their own, so the admin check runs here, first. */
export async function syncAction(_prev: SyncActionState, _formData: FormData): Promise<SyncActionState> {
  if (!(await requireSession("admin").catch(onlyForbidden))) return { ok: false, error: "Admins only." };
  // The id middleware verified for this request (the same one the audit trigger records).
  const result = await requestSync(createServerClient(), requestActor(), getConfig().githubSyncToken, fetch);
  revalidatePath("/sync");
  return result;
}
