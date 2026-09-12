/**
 * tests/app-shell/seed-e2e.check.ts — self-check for the seed script.
 * Usage: pnpm exec tsx tests/app-shell/seed-e2e.check.ts   (needs a configured Supabase project)
 * Seeds twice, asserts exactly one auth user + one profiles row, and that the account signs in.
 */
import assert from "node:assert/strict";
import { createClient } from "@supabase/supabase-js";
import { getConfig } from "../../lib/env";
import { createServerClient } from "../../lib/db/client";
import { loadEnvLocal, seedStaffE2e } from "./seed-e2e";

loadEnvLocal();
const email = process.env.E2E_EMAIL ?? "staff@example.test";
const password = process.env.E2E_PASSWORD ?? "password";

Promise.resolve()
  .then(async () => {
    const admin = createServerClient();
    const first = await seedStaffE2e(admin, email, password);
    const second = await seedStaffE2e(admin, email, password);
    assert.equal(second.id, first.id, "second run must reuse the same auth user");
    assert.equal(second.status, "existing");

    const { data, error } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
    assert.equal(error, null);
    const users = data.users.filter((u) => String(u.email).toLowerCase() === email.toLowerCase());
    assert.equal(users.length, 1, `expected exactly one auth user, got ${users.length}`);

    const rows = await admin.from("profiles").select("id, role, personid").eq("email", email);
    assert.equal(rows.error, null);
    assert.equal(rows.data?.length, 1, `expected exactly one profiles row, got ${rows.data?.length}`);
    assert.equal(rows.data?.[0].role, "staff");
    assert.equal(rows.data?.[0].personid, 1);

    const { supabaseUrl, supabaseAnonKey } = getConfig();
    const anon = createClient(supabaseUrl!, supabaseAnonKey!, { auth: { persistSession: false } });
    const signIn = await anon.auth.signInWithPassword({ email, password });
    assert.equal(signIn.error, null, `sign-in failed: ${signIn.error?.message}`);
    assert.ok(signIn.data.session?.access_token, "no session returned");

    process.stdout.write(`ok — 1 auth user, 1 profiles row (staff/personid 1), signInWithPassword succeeded for ${email}\n`);
  })
  .catch((err: Error) => {
    process.stderr.write(`${err.message}\n`);
    process.exit(1);
  });
