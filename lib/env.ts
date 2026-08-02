/**
 * env.ts — Single, lazy accessor for all runtime configuration.
 *
 * Every value is read from process.env at CALL TIME, never at module import.
 * This keeps the app buildable and importable when no keys are set: nothing
 * here throws or reads env as a side effect of `import`. Missing values come
 * back as `undefined` and each consumer decides how to degrade gracefully.
 */

/** Read a single env var, trimming and treating empty/whitespace as unset. */
function readEnv(name: string): string | undefined {
  const raw = process.env[name];
  if (raw === undefined) return undefined;
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

/** Coerce a truthy env flag ("1", "true", "yes", case-insensitive) to boolean. */
function readFlag(name: string): boolean {
  const v = readEnv(name)?.toLowerCase();
  return v === "1" || v === "true" || v === "yes";
}

export interface AppConfig {
  /** Direct Postgres connection string (Supabase project database). */
  databaseUrl?: string;
  /** Supabase project URL — browser-safe. */
  supabaseUrl?: string;
  /** Supabase anon key — browser-safe, subject to RLS. */
  supabaseAnonKey?: string;
  /**
   * Supabase service-role key — server-only. Bypasses RLS; must never be
   * referenced from any client-side code path.
   */
  supabaseServiceRoleKey?: string;
  anthropicApiKey?: string;
  /** Master switch for the opt-in AI module. Default OFF. */
  aiEnabled: boolean;
}

/**
 * Build the config snapshot from the current environment. Call this inside
 * request handlers / server components, not at module top level, so tests and
 * builds that run without env vars never trip over a missing value.
 */
export function getConfig(): AppConfig {
  return {
    databaseUrl: readEnv("DATABASE_URL"),
    supabaseUrl: readEnv("NEXT_PUBLIC_SUPABASE_URL"),
    supabaseAnonKey: readEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY"),
    supabaseServiceRoleKey: readEnv("SUPABASE_SERVICE_ROLE_KEY"),
    anthropicApiKey: readEnv("ANTHROPIC_API_KEY"),
    aiEnabled: readFlag("AI_ENABLED"),
  };
}
