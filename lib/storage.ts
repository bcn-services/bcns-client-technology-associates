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

export { type StorageAdapter } from "@nseluga/app-core";

/**
 * Resolve the configured adapter, or null when storage is unconfigured (the
 * keyless template runs with file features disabled, not crashing).
 *
 * Client builds implement and return a real adapter here — the platform
 * default is a Supabase Storage adapter; a WebDAV adapter is the documented
 * alternative when a client keeps their own file server.
 */
export function getStorageAdapter(): StorageAdapter | null {
  return null;
}
