/**
 * Admin account creation (LANE item 5). Server-only: callers pass the service-role
 * client in, so this module never builds one and tests can inject a fake.
 */
import { randomBytes } from "node:crypto";

/** 18 random bytes → 24 base64url chars. crypto.randomBytes — a CSPRNG, never a non-crypto PRNG. */
export function generateTempPassword(): string {
  return randomBytes(18).toString("base64url");
}

/** The slice of the service-role client createStaffUser needs. */
export interface AdminClient {
  auth: {
    admin: {
      createUser(a: { email: string; password: string; email_confirm: boolean }): PromiseLike<{
        data: { user: { id: string } | null };
        error: { message: string } | null;
      }>;
      deleteUser(id: string): PromiseLike<{ error: { message: string } | null }>;
    };
  };
  from(table: "profiles"): {
    insert(row: { id: string; email: string; role: string; personid: null }): PromiseLike<{ error: { message: string } | null }>;
  };
}

export type CreateResult = { ok: true; email: string; password: string } | { ok: false; error: string };

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function createStaffUser(
  admin: AdminClient,
  rawEmail: string,
  genPassword: () => string = generateTempPassword,
): Promise<CreateResult> {
  const email = rawEmail.trim().toLowerCase();
  if (!EMAIL_RE.test(email)) return { ok: false, error: "Enter a valid email address." };

  const password = genPassword();
  // email_confirm: true — the admin reads the password to the person; there is no confirmation email.
  const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (created.error || !created.data.user) {
    // An existing auth user is reported, never modified — its password stays untouched.
    if (created.error && /already.*registered/i.test(created.error.message))
      return { ok: false, error: `An account for ${email} already exists.` };
    return { ok: false, error: "Could not create the account. Please try again." };
  }

  const id = created.data.user.id;
  const { error } = await admin.from("profiles").insert({ id, email, role: "staff", personid: null });
  if (error) {
    // Rollback choice: delete the just-created auth user so a failed create leaves no
    // half-made account (an auth user with no profiles row can't sign in and blocks the email).
    await admin.auth.admin.deleteUser(id);
    return { ok: false, error: "Could not create the account. Please try again." };
  }
  return { ok: true, email, password };
}
