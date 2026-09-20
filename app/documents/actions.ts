"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/auth/session";
import { createServerClient } from "@/lib/db/client";
import { getStorageAdapter } from "@/lib/storage";
import type { Db } from "@/lib/time/entries";
import { firmToday } from "@/lib/cases/presets";
import { MAX_UPLOAD_BYTES, DocumentError, createCaseDocument, documentErrorMessage } from "@/lib/documents/store";

export type UploadState = { error: string } | { ok: string } | null;

/** Upload one file against a case. Any signed-in role; an anonymous caller is redirected by requireSession. */
export async function uploadCaseDocument(_prev: UploadState, formData: FormData): Promise<UploadState> {
  const session = await requireSession();
  const caseId = Number(formData.get("caseid"));
  if (!Number.isSafeInteger(caseId) || caseId <= 0) return { error: documentErrorMessage("notfound") };
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) return { error: documentErrorMessage("input") };
  if (file.size > MAX_UPLOAD_BYTES) return { error: documentErrorMessage("toolarge") };
  try {
    await createCaseDocument(
      createServerClient() as unknown as Db,
      getStorageAdapter(),
      session,
      caseId,
      { name: file.name, type: file.type, bytes: new Uint8Array(await file.arrayBuffer()) },
      firmToday(new Date()),
      randomUUID(),
    );
  } catch (e) {
    if (e instanceof DocumentError) return { error: documentErrorMessage(e.code) };
    // A storage fault is reported as a storage fault, never as "no such document".
    console.error("uploadCaseDocument:", e);
    return { error: documentErrorMessage("failed") };
  }
  revalidatePath(`/cases/${caseId}`);
  revalidatePath("/documents");
  return { ok: file.name };
}
