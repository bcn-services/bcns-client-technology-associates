/**
 * Case documents — the `tblscanneddocument` rows, and the ONE authorization rule
 * that every path able to reach the storage adapter goes through.
 *
 * The schema is frozen, so this feature maps onto columns that already exist:
 *   `filename`    — the STORAGE KEY, derived from canonical ids only (never the name typed)
 *   `description` — the original file name, for display
 *   `type`        — the content type
 */
import type { Db } from "@/lib/time/entries";
import type { Session } from "@/lib/auth/session";
import type { StorageAdapter } from "@/lib/storage";

export type DocRow = {
  id: number;
  caseid: number | null;
  dateadded: string | null;
  type: string | null;
  description: string | null;
  filename: string | null;
  // The other owners a document can hang off when `caseid` is null (expense, income, inquiry, bill, service authorization).
  expenseid?: number | null;
  incomeid?: number | null;
  inquiryid?: number | null;
  billid?: number | null;
  servauthid?: number | null;
};

const COLS = "id, caseid, dateadded, type, description, filename";
const OWNER_COLS = `${COLS}, expenseid, incomeid, inquiryid, billid, servauthid`;

/** A case-less row is still a real document when it is attached to some other record. */
const hasOtherOwner = (r: DocRow): boolean => [r.expenseid, r.incomeid, r.inquiryid, r.billid, r.servauthid].some((v) => v != null);

/** Upload cap. A module constant, not an env var: lib/env.ts is the only process.env reader. */
export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;
/** Signed-URL lifetime for a download hop. lib/storage.ts clamps anything above 900s. */
export const DOWNLOAD_URL_SECONDS = 120;

export type DocErrorCode = "auth" | "notfound" | "storage" | "input" | "toolarge" | "failed" | "legacy";

export class DocumentError extends Error {
  constructor(readonly code: DocErrorCode) {
    super(code);
    this.name = "DocumentError";
  }
}

const MESSAGES: Record<string, string> = {
  auth: "Sign in to use documents.",
  notfound: "That document is not available on this case.",
  // Distinct from notfound ON PURPOSE: "storage is misconfigured" must never be
  // reported to a user as "this document does not exist" (item 7 review finding).
  storage: "Document storage is unavailable — this is a configuration problem, not a missing file.",
  input: "Choose a file to upload.",
  toolarge: `That file is larger than ${MAX_UPLOAD_BYTES / (1024 * 1024)} MB.`,
  failed: "The document could not be saved.",
  legacy: "This scan is stored on the office NAS, not in the app. Open it from the NAS by its file name.",
};
export const documentErrorMessage = (code: string): string => MESSAGES[code] ?? MESSAGES.failed!;

/**
 * THE rule. Listing and direct-key alike call this BEFORE the storage adapter is
 * reached, so the two cannot drift apart.
 *
 * `caseid` is always the case the ROW says it belongs to (re-derived from the
 * database on the direct-key path) — never a case id supplied by the request.
 * `scope` is the case the caller is looking at; it can only NARROW access,
 * never grant it, so a forged `?case=` cannot widen anything.
 *
 * Any signed-in role may read any case (same model as the bills and funds panels);
 * per-case ACLs would go here, in this one function.
 */
export function assertDocumentAccess(
  session: Pick<Session, "role"> | null | undefined,
  caseid: number | null | undefined,
  scope?: number | null,
): number {
  if (!session) throw new DocumentError("auth");
  if (caseid == null || !Number.isSafeInteger(caseid)) throw new DocumentError("notfound");
  if (scope != null && scope !== caseid) throw new DocumentError("notfound");
  return caseid;
}

/** Storage key for a case document: canonical case id + an opaque token. Never user text. */
export const documentKey = (caseId: number, token: string): string => `cases/${caseId}/${token}`;

/**
 * A legacy scan: `filename` holds a bare NAS file name, not an app storage key. Must agree
 * with the `cases/` prefix `documentKey` writes. Null/empty is not "legacy" (no file at all).
 */
export const isLegacyFile = (f: string | null | undefined): boolean => !!f && !f.startsWith("cases/");

/** One case's documents, newest first. Authorized before the query; every row re-checked after it. */
export async function listCaseDocuments(db: Db, session: Pick<Session, "role"> | null, caseId: number): Promise<DocRow[]> {
  assertDocumentAccess(session, caseId);
  // ponytail: one unpaged read (PostgREST max-rows 1000) — page it if a case ever passes 1000 documents
  const { data, error } = await db.from("tblscanneddocument").select(COLS).eq("caseid", caseId).order("id", { ascending: false });
  if (error) throw new Error(`tblscanneddocument case read: ${error.message}`);
  // The .eq() is the case filter; this re-check means a driver or view that ignored
  // it still cannot leak another case's row into a list the panel trusts.
  return ((data ?? []) as DocRow[]).filter((r) => r.caseid === caseId);
}

/** The `/documents` index: every document, newest first. Any signed-in role. */
export async function listAllDocuments(db: Db, session: Pick<Session, "role"> | null, limit = 500): Promise<DocRow[]> {
  if (!session) throw new DocumentError("auth");
  const { data, error } = await db.from("tblscanneddocument").select(COLS).order("id", { ascending: false }).limit(limit);
  if (error) throw new Error(`tblscanneddocument read: ${error.message}`);
  return (data ?? []) as DocRow[];
}

/**
 * One document by id, for the direct-key (download) path. The row's own `caseid`
 * is read back from the database and authorized against — a caseid in the request
 * is only ever passed as `scope`, which can narrow and never grant.
 */
export async function loadDocument(db: Db, session: Pick<Session, "role"> | null, docId: number, scope?: number | null): Promise<DocRow> {
  if (!Number.isSafeInteger(docId) || docId <= 0) throw new DocumentError("notfound");
  const { data, error } = await db.from("tblscanneddocument").select(OWNER_COLS).eq("id", docId).maybeSingle();
  if (error) throw new Error(`tblscanneddocument read: ${error.message}`);
  if (!data) throw new DocumentError("notfound");
  const row = data as DocRow;
  // Documents attached to an expense/income/inquiry/bill have no case: any signed-in role may open them
  // (same model as cases), but a case scope can only ever match a case, so it refuses them.
  if (row.caseid == null && hasOtherOwner(row)) {
    if (!session) throw new DocumentError("auth");
    if (scope != null) throw new DocumentError("notfound");
  } else {
    assertDocumentAccess(session, row.caseid, scope);
  }
  if (!(data as DocRow).filename) throw new DocumentError("notfound");
  return data as DocRow;
}

/** Sign a download for an ALREADY-authorized row. A null adapter is a configuration fault, not a missing file. */
export async function documentDownloadUrl(storage: StorageAdapter | null, doc: DocRow): Promise<string> {
  // Decided from the row alone, so it never touches storage and cannot mislabel a bucket
  // fault; a misconfigured bucket must still surface as "storage" on app-key rows.
  if (isLegacyFile(doc.filename)) throw new DocumentError("legacy");
  if (!storage) throw new DocumentError("storage");
  if (!doc.filename) throw new DocumentError("notfound");
  return storage.getSignedUrl(doc.filename, DOWNLOAD_URL_SECONDS);
}

export type UploadFile = { name: string; type: string; bytes: Uint8Array };

/**
 * Upload one file against a case: bytes to storage, then exactly one row.
 * Bytes first on purpose — a failed insert leaves an unreferenced object, while a
 * failed upload after the insert would leave a row pointing at a file that is not there.
 * `token` and `today` are injected so the key and the date are testable.
 */
export async function createCaseDocument(
  db: Db,
  storage: StorageAdapter | null,
  session: Pick<Session, "role"> | null,
  caseId: number,
  file: UploadFile,
  today: string,
  token: string,
): Promise<{ id: number; key: string }> {
  assertDocumentAccess(session, caseId);
  if (file.bytes.byteLength === 0) throw new DocumentError("input");
  if (file.bytes.byteLength > MAX_UPLOAD_BYTES) throw new DocumentError("toolarge");
  if (!storage) throw new DocumentError("storage");
  const key = documentKey(caseId, token);
  await storage.putFile(key, file.bytes, file.type || "application/octet-stream");
  const ins = await db.from("tblscanneddocument")
    .insert({ caseid: caseId, dateadded: today, type: file.type || "application/octet-stream", description: file.name || key, filename: key })
    .select("id")
    .single();
  if (ins.error || !ins.data) throw new Error(`tblscanneddocument insert: ${ins.error?.message ?? "no row"}`);
  return { id: ins.data.id as number, key };
}
