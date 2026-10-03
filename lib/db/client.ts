/**
 * Server-side Supabase client (service role — bypasses RLS; never import from
 * client components). Config is read lazily through lib/env.ts.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { headers } from "next/headers";
import { getConfig } from "../env";
import { ACTOR_HEADER } from "./actor";
import type { Database } from "./types";

export type { Database } from "./types";
export type Tables<T extends keyof Database["public"]["Tables"]> = Database["public"]["Tables"][T]["Row"];
export type Inserts<T extends keyof Database["public"]["Tables"]> = Database["public"]["Tables"][T]["Insert"];
export type Updates<T extends keyof Database["public"]["Tables"]> = Database["public"]["Tables"][T]["Update"];

export class DbNotConfiguredError extends Error {
  constructor() {
    super("Supabase is not configured: NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required");
    this.name = "DbNotConfiguredError";
  }
}

/**
 * The signed-in user's id as middleware.ts verified it (middleware strips any
 * client-sent copy), or null outside a request (scripts/migrate, tests). Any other
 * error is Next's dynamic-rendering control flow and must propagate.
 */
export function requestActor(): string | null {
  try {
    return headers().get(ACTOR_HEADER);
  } catch (e) {
    if (e instanceof Error && e.message.includes("outside a request scope")) return null;
    throw e;
  }
}

/** Every request-scoped write carries the acting user's id, so audit_log.actor is filled (migration 0010). */
export function createServerClient(actor: string | null = requestActor()): SupabaseClient<Database> {
  const { supabaseUrl, supabaseServiceRoleKey } = getConfig();
  if (!supabaseUrl || !supabaseServiceRoleKey) throw new DbNotConfiguredError();
  return createClient<Database>(supabaseUrl, supabaseServiceRoleKey, {
    auth: { persistSession: false },
    global: { headers: actor ? { [ACTOR_HEADER]: actor } : {} },
  });
}
