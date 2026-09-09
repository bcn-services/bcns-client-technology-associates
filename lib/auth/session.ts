/**
 * Session contract (FOUNDATION.md item 7). A user without a `profiles` row has
 * no session — an invite that hasn't been granted a role is not a login.
 */
import { redirect } from "next/navigation";
import { createUserClient } from "./client";

export type Role = "admin" | "staff";
export type Session = { userId: string; email: string; role: Role; personId: number | null };

export class ForbiddenError extends Error {
  constructor(required: Role) {
    super(`requires role ${required}`);
    this.name = "ForbiddenError";
  }
}

/** The slice of a Supabase client this module needs — lets tests inject a fake. */
export interface SessionClient {
  auth: { getUser(): Promise<{ data: { user: { id: string; email?: string | null } | null } }> };
  from(table: "profiles"): {
    select(cols: string): {
      eq(col: "id", v: string): { maybeSingle(): PromiseLike<{ data: { role: string; personid: number | null } | null }> };
    };
  };
}

export async function getSession(client: SessionClient | null = createUserClient() as SessionClient | null): Promise<Session | null> {
  if (!client) return null;
  const { data: { user } } = await client.auth.getUser();
  if (!user) return null;
  const { data: profile } = await client.from("profiles").select("role, personid").eq("id", user.id).maybeSingle();
  if (!profile || (profile.role !== "admin" && profile.role !== "staff")) return null;
  return { userId: user.id, email: user.email ?? "", role: profile.role, personId: profile.personid ?? null };
}

export async function requireSession(
  role?: Role,
  client?: SessionClient | null,
  deps: { redirect: (url: string) => never } = { redirect },
): Promise<Session> {
  const session = await getSession(client === undefined ? undefined : client);
  if (!session) deps.redirect("/login");
  if (role === "admin" && session!.role !== "admin") throw new ForbiddenError(role);
  return session!;
}
