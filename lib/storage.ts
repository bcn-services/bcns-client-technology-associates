/**
 * storage.ts — This app's storage adapter seam.
 *
 * The StorageAdapter interface lives in @nseluga/app-core (platform
 * contract); this file resolves which implementation THIS client uses.
 * Platform default is Supabase Storage in the client's own project; a
 * client-specific backend (e.g. self-hosted Nextcloud over WebDAV)
 * implements the same interface so it never hardens into the template.
 * Keys are ALWAYS derived from canonical business ids — no name-based
 * lookups; private content via signed, expiring URLs.
 */

import type { StorageAdapter } from "@nseluga/app-core";
import { createServerClient, DbNotConfiguredError } from "@/lib/db/client";

export { type StorageAdapter } from "@nseluga/app-core";

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

/** Supabase returns errors as values; NoSuchKey/404 becomes the defined not-found error. */
function toError(key: string, err: unknown): Error {
  const e = err as { message?: string; statusCode?: string; code?: string } | null;
  if (e?.code === "NoSuchKey" || e?.statusCode === "404") return new StorageObjectNotFoundError(key);
  return new StorageOperationError(key, e?.message ?? String(err));
}

/**
 * Resolve the configured adapter, or null when storage is unconfigured (the
 * keyless template runs with file features disabled, not crashing).
 */
export function getStorageAdapter(): StorageAdapter | null {
  let bucket: ReturnType<ReturnType<typeof createServerClient>["storage"]["from"]>;
  try {
    bucket = createServerClient().storage.from(STORAGE_BUCKET);
  } catch (e) {
    if (e instanceof DbNotConfiguredError) return null;
    throw e;
  }
  return {
    async putFile(key: string, bytes: Uint8Array, contentType: string): Promise<void> {
      const { error } = await bucket.upload(key, bytes, { contentType, upsert: true });
      if (error) throw toError(key, error);
    },
    async getSignedUrl(key: string, expiresInSeconds: number): Promise<string> {
      const { data, error } = await bucket.createSignedUrl(key, expiresInSeconds);
      if (error || !data) throw toError(key, error);
      return data.signedUrl;
    },
    async listKeys(prefix: string): Promise<string[]> {
      const { data, error } = await bucket.list(prefix);
      if (error || !data) throw toError(prefix, error);
      const base = prefix.replace(/\/+$/, "");
      // list() names are relative to the prefix, and folders come back with a null id;
      // drop those so every returned key is one getSignedUrl can actually sign.
      return data.filter((e) => e.id !== null).map((e) => (base ? `${base}/${e.name}` : e.name));
    },
  };
}
