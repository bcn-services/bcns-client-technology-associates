/**
 * Server-side Supabase client (service role — bypasses RLS; never import from
 * client components). Config is read lazily through lib/env.ts.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { getConfig } from "../env";
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

export function createServerClient(): SupabaseClient<Database> {
  const { supabaseUrl, supabaseServiceRoleKey } = getConfig();
  if (!supabaseUrl || !supabaseServiceRoleKey) throw new DbNotConfiguredError();
  return createClient<Database>(supabaseUrl, supabaseServiceRoleKey, { auth: { persistSession: false } });
}
