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

  const { error } = await supabase!.auth.signInWithPassword({ email, password });
  if (error) back("invalid");

  redirect(next);
}
