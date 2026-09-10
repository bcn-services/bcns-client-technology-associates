/**
 * Admin account creation (LANE item 5). Server-only: callers pass the service-role
 * client in, so this module never builds one and tests can inject a fake.
 */
import { randomBytes } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/db/client";

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

// ---------------------------------------------------------------------------
// LANE item 6: role change, deactivation, billing person.
//
// Deactivation = delete the `profiles` row only (FOUNDATION: no profiles row ⇒ no
// session). auth.users is never touched, so re-inserting the row restores sign-in.
//
// Last-admin guard, no migration allowed, so no DB-side lock or trigger. Approach:
// pre-check (≥2 admins incl. target) → mutate → RE-COUNT admins. If the recount
// errors or is 0, undo the mutation (re-insert the saved row / set role back) and
// refuse. Two concurrent removals of the last two admins both see 0 on recount
// and both undo, or the later one sees the first's undo and proceeds — either way
// ≥1 admin survives. Every unknown (query error, null count, missing id) refuses.
// ponytail: residual window — between mutate and undo, 0 admins exist for one
// round trip; and if the undo itself fails we report it loudly. A Postgres
// function with a row lock closes both, add it if a migration is ever allowed.
// ---------------------------------------------------------------------------

type Db = SupabaseClient<Database>;
type ProfileRow = Database["public"]["Tables"]["profiles"]["Row"];
export type ManageResult = { ok: true; message: string } | { ok: false; error: string };

const refuse = (error: string): ManageResult => ({ ok: false, error });
const RETRY = "Could not confirm another admin remains — nothing was changed.";

async function loadProfile(db: Db, id: string): Promise<ProfileRow | null> {
  const { data, error } = await db.from("profiles").select("*").eq("id", id).maybeSingle();
  return error ? null : data;
}

/** Admin count, or null when it cannot be positively known (error / null count). */
async function adminCount(db: Db): Promise<number | null> {
  const { count, error } = await db.from("profiles").select("id", { count: "exact", head: true }).eq("role", "admin");
  return error || typeof count !== "number" ? null : count;
}

export async function deactivateUser(db: Db, actorId: string | null | undefined, targetId: string | null | undefined): Promise<ManageResult> {
  if (!actorId || !targetId) return refuse("Missing account id — nothing was changed.");
  if (actorId === targetId) return refuse("You cannot deactivate your own account.");

  const row = await loadProfile(db, targetId);
  if (!row) return refuse("That account was not found or could not be read.");

  const wasAdmin = row.role === "admin";
  if (wasAdmin) {
    const n = await adminCount(db);
    if (n === null) return refuse(RETRY);
    if (n < 2) return refuse("You cannot deactivate the last remaining admin.");
  }

  const del = await db.from("profiles").delete().eq("id", targetId).select("id");
  if (del.error) return refuse("Could not deactivate the account. Nothing was changed.");
  if (!del.data?.length) return refuse("That account was already deactivated.");

  if (wasAdmin) {
    const after = await adminCount(db);
    if (after === null || after < 1) {
      const { error } = await db.from("profiles").insert(row);
      if (error) {
        console.error(`deactivateUser: restore of profiles row ${targetId} FAILED: ${error.message}`);
        return refuse("Deactivation was undone but the restore failed — contact support now.");
      }
      return refuse(after === null ? RETRY : "You cannot deactivate the last remaining admin.");
    }
  }
  return { ok: true, message: `Deactivated ${row.email}.` };
}

export async function setUserRole(db: Db, targetId: string | null | undefined, rawRole: unknown): Promise<ManageResult> {
  if (rawRole !== "admin" && rawRole !== "staff") return refuse("Role must be admin or staff.");
  if (!targetId) return refuse("Missing account id — nothing was changed.");
  const row = await loadProfile(db, targetId);
  if (!row) return refuse("That account was not found or could not be read.");
  if (row.role === rawRole) return { ok: true, message: `${row.email} is already ${rawRole}.` };

  const demoting = row.role === "admin";
  if (demoting) {
    const n = await adminCount(db);
    if (n === null) return refuse(RETRY);
    if (n < 2) return refuse("You cannot demote the last remaining admin.");
  }

  // Conditional on the role we read, so a concurrent change is not silently overwritten.
  const upd = await db.from("profiles").update({ role: rawRole }).eq("id", targetId).eq("role", row.role).select("id");
  if (upd.error) return refuse("Could not change the role. Nothing was changed.");
  if (!upd.data?.length) return refuse("That account changed meanwhile — reload and try again.");

  if (demoting) {
    const after = await adminCount(db);
    if (after === null || after < 1) {
      const { error } = await db.from("profiles").update({ role: "admin" }).eq("id", targetId);
      if (error) {
        console.error(`setUserRole: revert of ${targetId} to admin FAILED: ${error.message}`);
        return refuse("Demotion was undone but the revert failed — contact support now.");
      }
      return refuse(after === null ? RETRY : "You cannot demote the last remaining admin.");
    }
  }
  return { ok: true, message: `${row.email} is now ${rawRole}.` };
}

/** Empty → null. Otherwise must be an existing tblbillingnames.personid. */
export async function setBillingPerson(db: Db, targetId: string | null | undefined, raw: unknown): Promise<ManageResult> {
  if (!targetId) return refuse("Missing account id — nothing was changed.");
  const s = typeof raw === "string" ? raw.trim() : "";
  let personid: number | null = null;
  if (s !== "") {
    if (!/^\d{1,5}$/.test(s)) return refuse("Choose a billing person from the list.");
    const { data, error } = await db.from("tblbillingnames").select("personid").eq("personid", Number(s)).maybeSingle();
    if (error || !data) return refuse("Choose a billing person from the list.");
    personid = data.personid;
  }
  const upd = await db.from("profiles").update({ personid }).eq("id", targetId).select("id");
  if (upd.error) return refuse("Could not set the billing person. Nothing was changed.");
  if (!upd.data?.length) return refuse("That account was not found.");
  return { ok: true, message: personid === null ? "Billing person cleared." : "Billing person set." };
}
