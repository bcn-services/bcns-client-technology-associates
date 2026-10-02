"use server";

import { redirect } from "next/navigation";
import { createUserClient } from "@/lib/auth/client";
import { safeNext } from "@/lib/auth/safe-next";

/**
 * On failure, bounce back to /login with an error code and the (validated) next —
 * never the email or password. A failed signInWithPassword writes no session cookie.
 */
export async function signIn(formData: FormData): Promise<never> {
  const next = safeNext(formData.get("next"));
  const email = String(formData.get("email") ?? "");
  const password = String(formData.get("password") ?? "");

  const back = (error: string) =>
    redirect(`/login?${new URLSearchParams({ error, next }).toString()}`);

  const supabase = createUserClient();
  if (!supabase) back("unavailable");

  const { data, error } = await supabase!.auth.signInWithPassword({ email, password });
  // Banned (deactivated) users land here too, on purpose: GoTrue checks the ban BEFORE the password,
  // so a distinct message for user_banned would reveal which emails are deactivated to anyone typing a wrong password.
  if (error) back("invalid");

  // A deactivated account (no profiles row) authenticates fine, then the gate would bounce
  // it back here with no message. Same role rule as getSession(); sign out so no session is kept.
  const { data: profile, error: profileError } = await supabase!
    .from("profiles").select("role").eq("id", data.user!.id).maybeSingle();
  if (profileError || (profile?.role !== "admin" && profile?.role !== "staff")) {
    await supabase!.auth.signOut();
    back(profileError ? "unavailable" : "deactivated");
  }

  redirect(next);
}
