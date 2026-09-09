// scripts/migrate/seed-logins.mjs — create the first Supabase auth users and their profiles rows.
// Usage: node_modules/.bin/tsx scripts/migrate/seed-logins.mjs <logins.json>   (profiles target from MIGRATE_DB_URL)
// Input: [{ email, role: "admin"|"staff", personid: number|null }] — see logins.example.json.
// No password is ever set: users come in through the app's invite/reset flow.
// Importing this module connects to nothing and creates nobody; only the CLI entry below runs.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

// MIGRATE_DB_URL is this lane's only env read; the harness derives DB_URL from FOUNDATION_PG_URL.
if (process.env.MIGRATE_DB_URL) process.env.FOUNDATION_PG_URL = process.env.MIGRATE_DB_URL;
const { sql, literal } = await import("../../tests/foundation/harness.mjs");

/** Shape + role check for the whole file. Throws on the first bad entry; creates nothing. */
export function validate(entries) {
  if (!Array.isArray(entries)) throw new Error("logins file must be a JSON array");
  if (entries.length === 0) throw new Error("logins file is empty");
  entries.forEach((e, i) => {
    const at = `entry ${i}`;
    if (!e || typeof e !== "object" || Array.isArray(e)) throw new Error(`${at}: not an object`);
    if (typeof e.email !== "string" || !/^[^@\s]+@[^@\s]+$/.test(e.email)) throw new Error(`${at}: bad email ${JSON.stringify(e.email)}`);
    // The frozen Session/Role contract (lib/auth/session.ts) has exactly these two values.
    if (e.role !== "admin" && e.role !== "staff") throw new Error(`${at} (${e.email}): role must be "admin" or "staff", got ${JSON.stringify(e.role)}`);
    if (!(e.personid === null || (Number.isInteger(e.personid) && e.personid > 0))) throw new Error(`${at} (${e.email}): personid must be a positive integer or null, got ${JSON.stringify(e.personid)}`);
  });
}

/** Every non-null personid must already exist in tblbillingnames. Throws before anything is created. */
export function checkPersonIds(entries, q = sql) {
  const ids = [...new Set(entries.map((e) => e.personid).filter((v) => v !== null))];
  if (ids.length === 0) return;
  const found = new Set(q(`select personid::text from tblbillingnames where personid in (${ids.join(",")});`).map((r) => r[0]));
  const missing = ids.filter((id) => !found.has(String(id)));
  if (missing.length) throw new Error(`personid not in tblbillingnames: ${missing.join(", ")}`);
}

// auth-js 2.116 has no getUserByEmail, so the "already registered" path pages listUsers().
// ponytail: linear scan of every auth user; fine for a firm-sized tenant, revisit past ~10k logins.
const PER_PAGE = 1000;
async function findUserByEmail(admin, email) {
  for (let page = 1; ; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: PER_PAGE });
    if (error) throw new Error(`${email}: ${error.message}`);
    const hit = data.users.find((u) => String(u.email).toLowerCase() === email.toLowerCase());
    if (hit) return hit.id;
    if (data.users.length < PER_PAGE) throw new Error(`${email}: reported as already registered but not found`);
  }
}

/**
 * Validates the whole file up front, then creates users and upserts profiles.
 * Idempotent on email: a second run creates nobody and only carries role/personid changes across.
 * Returns one `email → role (created|existing)` line per entry.
 */
export async function seedLogins(entries, { admin, q = sql } = {}) {
  validate(entries);
  checkPersonIds(entries, q);
  const lines = [];
  for (const e of entries) {
    // email only — never a password, and never anything else.
    const { data, error } = await admin.auth.admin.createUser({ email: e.email, email_confirm: true });
    let id, status;
    if (error && /already.*registered/i.test(error.message)) {
      id = await findUserByEmail(admin, e.email);
      status = "existing";
    } else if (error) {
      throw new Error(`${e.email}: ${error.message}`);
    } else {
      id = data.user.id;
      status = "created";
    }
    q(`insert into profiles (id, email, role, personid) values (${literal(id)}, ${literal(e.email)}, ${literal(e.role)}, ${literal(e.personid)})
       on conflict (id) do update set email = excluded.email, role = excluded.role, personid = excluded.personid;`);
    lines.push(`${e.email} → ${e.role} (${status})`);
  }
  return lines;
}

// --- CLI entry: runs only when this file is the process entrypoint ----------
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const file = process.argv[2];
  if (!file) {
    process.stderr.write("usage: node_modules/.bin/tsx scripts/migrate/seed-logins.mjs <logins.json>\n");
    process.exit(2);
  }
  const { createServerClient } = await import("../../lib/db/client.ts");
  const lines = await seedLogins(JSON.parse(readFileSync(file, "utf8")), { admin: createServerClient() });
  process.stdout.write(lines.join("\n") + "\n");
}
