/** Cookie-bound Supabase client for the signed-in user (anon key, RLS applies). Server components / route handlers only. */
import { createServerClient as createSsrClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { getConfig } from "../env";
import type { Database } from "../db/types";

export function createUserClient() {
  const { supabaseUrl, supabaseAnonKey } = getConfig();
  if (!supabaseUrl || !supabaseAnonKey) return null;
  const store = cookies();
  return createSsrClient<Database>(supabaseUrl, supabaseAnonKey, {
    cookies: {
      getAll: () => store.getAll(),
      setAll: (list) => {
        try { for (const { name, value, options } of list) store.set(name, value, options); } catch { /* read-only context (server component) — middleware refreshes */ }
      },
    },
  });
}
