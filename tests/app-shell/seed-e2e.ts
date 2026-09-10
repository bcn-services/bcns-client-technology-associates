/**
 * tests/app-shell/seed-e2e.ts — create the account tests/journeys/*.spec.ts log in as.
 * Usage: pnpm exec tsx tests/app-shell/seed-e2e.ts
 *
 * Idempotent: a second run creates no duplicate auth user and no duplicate profiles row,
 * it just re-applies the password/role. Credentials are the same E2E_EMAIL / E2E_PASSWORD
 * pair tests/journeys/helpers.ts reads, with the same throwaway defaults — never a real person.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { createServerClient } from "../../lib/db/client";

/** Fill unset vars from .env.local (gitignored, not loaded by tsx). Config itself still comes from getConfig(). */
export function loadEnvLocal(): void {
  let text: string;
  try {
    text = readFileSync(new URL("../../.env.local", import.meta.url), "utf8");
  } catch {
    return; // no file — rely on the ambient environment
  }
  for (const line of text.split("\n")) {
    const m = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!m || line.trimStart().startsWith("#")) continue;
    if (process.env[m[1]] === undefined) process.env[m[1]] = m[2].trim().replace(/^(['"])(.*)\1$/, "$2");
  }
}

// auth-js 2.116 has no getUserByEmail, so the "already registered" path pages listUsers().
// ponytail: linear scan of every auth user; fine for a test project, revisit past ~10k logins.
const PER_PAGE = 1000;
async function findUserByEmail(admin: ReturnType<typeof createServerClient>, email: string): Promise<string> {
  for (let page = 1; ; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: PER_PAGE });
    if (error) throw new Error(`${email}: ${error.message}`);
    const hit = data.users.find((u) => String(u.email).toLowerCase() === email.toLowerCase());
    if (hit) return hit.id;
    if (data.users.length < PER_PAGE) throw new Error(`${email}: reported as already registered but not found`);
  }
}

export async function seedE2eUser(admin: ReturnType<typeof createServerClient>, email: string, password: string) {
  // email_confirm: true is mandatory — no mailbox exists, an unconfirmed account can never sign in.
  const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  let id: string, status: "created" | "existing";
  if (created.error && /already.*(registered|been registered)/i.test(created.error.message)) {
    id = await findUserByEmail(admin, email);
    status = "existing";
    const { error } = await admin.auth.admin.updateUserById(id, { password, email_confirm: true });
    if (error) throw new Error(`${email}: ${error.message}`);
  } else if (created.error) {
    throw new Error(`${email}: ${created.error.message}`);
  } else {
    id = created.data.user.id;
    status = "created";
  }

  const { error } = await admin.from("profiles").upsert({ id, email, role: "staff", personid: null }, { onConflict: "id" });
  if (error) throw new Error(`${email}: profiles upsert failed: ${error.message}`);
  return { id, status };
}

// --- CLI entry: runs only when this file is the process entrypoint ----------
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  loadEnvLocal();
  const email = process.env.E2E_EMAIL ?? "staff@example.test";
  const password = process.env.E2E_PASSWORD ?? "password";
  // No top-level await: package.json has no "type": "module", so this file transpiles to CJS.
  Promise.resolve()
    .then(() => seedE2eUser(createServerClient(), email, password))
    .then(({ id, status }) => process.stdout.write(`${email} → staff (${status}) ${id}\n`))
    .catch((err: Error) => {
      process.stderr.write(`${err.message}\n`);
      process.exit(1);
    });
}
