/**
 * storage.ts — This app's storage adapter seam.
 *
 * The StorageAdapter interface lives in @bcn-services/app-core (platform
 * contract); this file resolves which implementation THIS client uses.
 * Platform default is Supabase Storage in the client's own project; a
 * client-specific backend (e.g. self-hosted Nextcloud over WebDAV)
 * implements the same interface so it never hardens into the template.
 * Keys are ALWAYS derived from canonical business ids — no name-based
 * lookups; private content via signed, expiring URLs.
 */

import type { StorageAdapter } from "@bcn-services/app-core";
import { createServerClient, DbNotConfiguredError } from "@/lib/db/client";

export { type StorageAdapter } from "@bcn-services/app-core";

/**
 * The private bucket holding case documents. It is created by ops (and, for
 * tests, by tests/docs-reports/local-stack-setup.sh) — never at runtime, and
 * never public: every read is a short-lived signed URL.
 * Named here rather than in lib/env.ts because that seam is frozen.
 */
export const STORAGE_BUCKET = "case-documents";

/** A key that does not exist in the bucket — a defined outcome, not a 500. */
export class StorageObjectNotFoundError extends Error {
  constructor(key: string) {
    super(`storage object not found: ${key}`);
    this.name = "StorageObjectNotFoundError";
  }
}

/** Any other storage-backend failure, surfaced with its key for triage. */
export class StorageOperationError extends Error {
  constructor(key: string, cause: string) {
    super(`storage operation failed for ${key}: ${cause}`);
    this.name = "StorageOperationError";
  }
}

/**
 * Supabase returns errors as values; only NoSuchKey becomes the defined
 * not-found error. Neither `statusCode` NOR `code` is a safe discriminator on
 * its own: storage answers 404 for a missing BUCKET too, as `code:"NoSuchBucket"`
 * from `upload` but as the byte-identical `{"statusCode":"404","code":"NoSuchKey",
 * "message":"Object not found"}` from `createSignedUrl` — so on the sign path the
 * code alone cannot tell a missing bucket from a missing object. Callers that can
 * hit that shape must go through `toNotFoundOrFault`, which confirms the bucket.
 * Any shape without `code: "NoSuchKey"` — including an unknown one — falls
 * through to StorageOperationError.
 */
function toError(key: string, err: unknown, fallbackCause = "unknown storage error"): Error {
  const e = err as { message?: string; code?: string } | null;
  if (e?.code === "NoSuchKey") return new StorageObjectNotFoundError(key);
  return new StorageOperationError(key, e?.message ?? (err == null ? fallbackCause : String(err)));
}

/** Upper bound on a caller-chosen signed-URL lifetime. A module constant, not an
 *  env var: lib/env.ts is the only process.env reader and this seam is frozen. */
const MAX_SIGNED_URL_SECONDS = 900;

/** Supabase `list()` returns at most one page; walk every page so a case with
 *  more than a page of documents never returns a silently short list. */
const LIST_PAGE_SIZE = 100;

/**
 * Resolve the configured adapter, or null when storage is unconfigured (the
 * keyless template runs with file features disabled, not crashing).
 */
export function getStorageAdapter(): StorageAdapter | null {
  let storage: ReturnType<typeof createServerClient>["storage"];
  let bucket: ReturnType<ReturnType<typeof createServerClient>["storage"]["from"]>;
  try {
    storage = createServerClient().storage;
    bucket = storage.from(STORAGE_BUCKET);
  } catch (e) {
    if (e instanceof DbNotConfiguredError) return null;
    throw e;
  }

  /**
   * Resolve a NoSuchKey-shaped failure that could equally be a missing bucket by
   * asking the backend whether the bucket exists. Runs only on the error path.
   * Fails toward "storage fault": only a clean bucket record downgrades to
   * StorageObjectNotFoundError, so a misconfigured or unreachable bucket can never
   * be reported to a user as "this document does not exist".
   */
  async function toNotFoundOrFault(key: string, err: unknown, fallbackCause?: string): Promise<Error> {
    const mapped = toError(key, err, fallbackCause);
    if (!(mapped instanceof StorageObjectNotFoundError)) return mapped;
    const { data, error } = await storage.getBucket(STORAGE_BUCKET);
    if (error || !data) return new StorageOperationError(key, `bucket ${STORAGE_BUCKET} unavailable: ${error?.message ?? "no bucket record"}`);
    return mapped;
  }

  return {
    async putFile(key: string, bytes: Uint8Array, contentType: string): Promise<void> {
      // ponytail: upsert makes a retry idempotent, but reusing a docId overwrites the
      // prior bytes irrecoverably — move to write-once keys when versioning is specified.
      const { error } = await bucket.upload(key, bytes, { contentType, upsert: true });
      if (error) throw toError(key, error);
    },
    async getSignedUrl(key: string, expiresInSeconds: number): Promise<string> {
      const ttl = Math.min(expiresInSeconds, MAX_SIGNED_URL_SECONDS);
      const { data, error } = await bucket.createSignedUrl(key, ttl);
      if (error || !data) throw await toNotFoundOrFault(key, error, "createSignedUrl returned no data");
      return data.signedUrl;
    },
    async listKeys(prefix: string): Promise<string[]> {
      const base = prefix.replace(/\/+$/, "");
      const keys: string[] = [];
      for (let offset = 0; ; offset += LIST_PAGE_SIZE) {
        const { data, error } = await bucket.list(prefix, { limit: LIST_PAGE_SIZE, offset });
        if (error || !data) throw toError(prefix, error, "list returned no data");
        // list() names are relative to the prefix, and folders come back with a null id;
        // drop those so every returned key is one getSignedUrl can actually sign.
        for (const e of data) if (e.id !== null) keys.push(base ? `${base}/${e.name}` : e.name);
        // Offset still advances by the RAW page length, filtered entries included.
        if (data.length < LIST_PAGE_SIZE) return keys;
      }
    },
  };
}
