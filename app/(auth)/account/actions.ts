"use server";

import { requireSession } from "@/lib/auth/session";
import { createUserClient } from "@/lib/auth/client";

export type PasswordState = { ok: true } | { ok: false; error: string } | null;

const MIN_LENGTH = 8; // Supabase's floor is 6; 8 is ours.

/**
 * Changes the signed-in user's own password. The target user and the re-auth email
 * come from the session, never the form — a crafted POST can't aim at another account.
 * Neither password is ever returned, redirected, or logged.
 */
export async function changePasswordAction(_prev: PasswordState, formData: FormData): Promise<PasswordState> {
  const session = await requireSession();
  const current = String(formData.get("current") ?? "");
  const next = String(formData.get("new") ?? "");
  const confirm = String(formData.get("confirm") ?? "");

  if (!current || !next) return { ok: false, error: "Enter your current and new password." };
  if (next !== confirm) return { ok: false, error: "New password and confirmation do not match." };
  if (next.length < MIN_LENGTH) return { ok: false, error: `New password must be at least ${MIN_LENGTH} characters.` };
  if (next === current) return { ok: false, error: "New password must differ from the current one." };

  const supabase = createUserClient();
  if (!supabase) return { ok: false, error: "Sign-in service unavailable." };

  // Re-authenticate as the session's own email: proves the caller knows the current password.
  const { error: authError } = await supabase.auth.signInWithPassword({ email: session.email, password: current });
  if (authError?.status === 429) return { ok: false, error: "Too many attempts. Wait a minute and try again." };
  if (authError) return { ok: false, error: "Current password is incorrect." };

  const { error } = await supabase.auth.updateUser({ password: next });
  if (error) return { ok: false, error: `Could not change password: ${error.message}` };
  return { ok: true };
}
