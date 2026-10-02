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
      updateUserById(id: string, attrs: { ban_duration: string }): PromiseLike<{ error: { message: string } | null }>;
      listUsers(a: { page: number; perPage: number }): PromiseLike<{
        data: { users: { id: string; email?: string | null }[] };
        error: { message: string } | null;
      }>;
    };
  };
  from(table: "profiles"): {
    insert(row: { id: string; email: string; role: string; personid: null }): PromiseLike<{ error: { message: string; code?: string } | null }>;
  };
}

/** `password: null` = a deactivated account was reactivated and keeps its existing password. */
export type CreateResult = { ok: true; email: string; password: string | null } | { ok: false; error: string };

// auth-js 2.116 has no getUserByEmail, so paging listUsers() is the only lookup.
// ponytail: linear scan of every auth user; fine at this firm's size, revisit past ~10k logins.
const PER_PAGE = 1000;
async function findAuthUserId(admin: AdminClient, email: string): Promise<string | null> {
  for (let page = 1; ; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: PER_PAGE });
    if (error) return null;
    const hit = data.users.find((u) => String(u.email).toLowerCase() === email);
    if (hit) return hit.id;
    if (data.users.length < PER_PAGE) return null;
  }
}

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
    if (created.error && /already.*registered/i.test(created.error.message)) return reactivate(admin, email);
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

/**
 * The auth user exists. Deactivation deletes the profiles row and bans the auth user, so
 * reactivation lifts the ban (before the insert: a failed unban must not leave an account
 * that looks active but cannot sign in), then re-inserts the row as staff. The password is
 * never touched. A primary-key conflict means the row is still there: an active account, reported as a duplicate.
 */
async function reactivate(admin: AdminClient, email: string): Promise<CreateResult> {
  const id = await findAuthUserId(admin, email);
  if (!id) return { ok: false, error: "Could not create the account. Please try again." };
  const unban = await admin.auth.admin.updateUserById(id, { ban_duration: "none" });
  if (unban.error) return { ok: false, error: "Could not reactivate the account. Please try again." };
  const { error } = await admin.from("profiles").insert({ id, email, role: "staff", personid: null });
  if (error?.code === "23505") return { ok: false, error: `An account for ${email} already exists.` };
  if (error) return { ok: false, error: "Could not reactivate the account. Please try again." };
  return { ok: true, email, password: null };
}

// ---------------------------------------------------------------------------
// LANE item 6: role change, deactivation, billing person.
//
// Deactivation = delete the `profiles` row (FOUNDATION: no profiles row ⇒ no session),
// then ban the auth user so it cannot mint a JWT at all. The ban runs last, after the
// last-admin recount passes; if it fails the deactivation stands (the profiles gate holds)
// and the success message carries a warning. Reactivation unbans, then re-inserts the row.
//
// Last-admin guard, no migration allowed, so no DB-side lock or trigger. Approach:
// pre-check (≥2 admins incl. target) → mutate → RE-COUNT admins. If the recount
// errors or is 0, undo the mutation (re-insert the saved row / set role back) and
// refuse. Two concurrent removals of the last two admins both see 0 on recount
// and both undo, or the later one sees the first's undo and proceeds — either way
// ≥1 admin survives. Every unknown (query error, null count, missing id) refuses.
// ponytail: residual window — between mutate and undo, 0 admins exist for one
// round trip; the deactivation undo re-inserts the row snapshot, so a personid
// changed concurrently inside that window is silently reverted; and if the undo
// itself fails we report it loudly. A Postgres
// function with a row lock closes both, add it if a migration is ever allowed.
// ---------------------------------------------------------------------------

type Db = SupabaseClient<Database>;
type ProfileRow = Database["public"]["Tables"]["profiles"]["Row"];
export type ManageResult = { ok: true; message: string } | { ok: false; error: string };

const refuse = (error: string): ManageResult => ({ ok: false, error });
const RETRY = "Could not confirm another admin remains — nothing was changed.";
const CHANGED = "That account changed meanwhile — reload and try again.";
const UNDO_FAILED = (what: string) =>
  `${what} went through, but undoing it failed — there may be no admin left; contact support now.`;

/** Canonical form for comparing ids: Postgres uuid matching ignores case and {braces}. */
const canon = (id: string) => id.trim().toLowerCase().replace(/[{}]/g, "");

/** For server actions: a ForbiddenError (staff caller) becomes null; anything else (e.g. Next's redirect) is rethrown. */
export function onlyForbidden(e: unknown): null {
  if (e instanceof Error && e.name === "ForbiddenError") return null;
  throw e;
}

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
  const SELF = "You cannot deactivate your own account.";
  if (canon(actorId) === canon(targetId)) return refuse(SELF);

  const row = await loadProfile(db, targetId);
  if (!row) return refuse("That account was not found or could not be read.");
  // Re-check against the DB's canonical id: the form string may match the actor's row
  // in Postgres (case, braces, hyphenation) without being string-equal to it.
  if (!row.id || canon(row.id) === canon(actorId)) return refuse(SELF);

  const wasAdmin = row.role === "admin";
  if (wasAdmin) {
    const n = await adminCount(db);
    if (n === null) return refuse(RETRY);
    if (n < 2) return refuse("You cannot deactivate the last remaining admin.");
  }

  // Conditional on the role we read: a target promoted meanwhile must not be deleted
  // as "staff" (that would skip the last-admin pre-check and the recount).
  const del = await db.from("profiles").delete().eq("id", row.id).eq("role", row.role).select("id");
  if (del.error) return refuse("Could not deactivate the account. Nothing was changed.");
  if (!del.data?.length) return refuse(CHANGED);

  if (wasAdmin) {
    const after = await adminCount(db);
    if (after === null || after < 1) {
      const { error } = await db.from("profiles").insert(row);
      if (error) {
        console.error(`deactivateUser: restore of profiles row ${row.id} FAILED: ${error.message}`);
        return refuse(UNDO_FAILED(`Deactivating ${row.email}`));
      }
      return refuse(after === null ? RETRY : "You cannot deactivate the last remaining admin.");
    }
  }
  // ponytail: if another admin re-creates this email between the delete and this ban, the stale
  // ban lands after reactivate's unban — upgrade: re-check the profile after the ban, unban if it reappeared.
  // 876000h ≈ 100 years. Only reached once the deletion is final (no undo path below here).
  const ban = await db.auth.admin.updateUserById(row.id, { ban_duration: "876000h" });
  if (ban.error) {
    console.error(`deactivateUser: ban of auth user ${row.id} FAILED: ${ban.error.message}`);
    return { ok: true, message: `Deactivated ${row.email}, but blocking their login failed — they cannot use the app, but tell support so the sign-in ban can be applied.` };
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
  const upd = await db.from("profiles").update({ role: rawRole }).eq("id", row.id).eq("role", row.role).select("id");
  if (upd.error) return refuse("Could not change the role. Nothing was changed.");
  if (!upd.data?.length) return refuse(CHANGED);

  if (demoting) {
    const after = await adminCount(db);
    if (after === null || after < 1) {
      const { data, error } = await db.from("profiles").update({ role: "admin" }).eq("id", row.id).select("id");
      // 0 rows restored (row deleted concurrently) is an undo failure too, not a clean refusal.
      if (error || !data?.length) {
        console.error(`setUserRole: revert of ${row.id} to admin FAILED: ${error?.message ?? "0 rows matched"}`);
        return refuse(UNDO_FAILED(`Demoting ${row.email}`));
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
