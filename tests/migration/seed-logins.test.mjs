// tests/migration/seed-logins.test.mjs — scripts/migrate/seed-logins.mjs against the harness DB
// with an injected fake admin client (no Supabase project needed; the fake runs on every run).
// Run directly (package.json's `test` glob does not reach tests/migration/):
//   node_modules/.bin/tsx --test --test-concurrency=1 tests/migration/*.test.mjs
import { test, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { DB_URL, sql, one, resetDb, insertSql } from "../foundation/harness.mjs";
import { seedLogins, validate, checkPersonIds } from "../../scripts/migrate/seed-logins.mjs";

const ROOT = new URL("../..", import.meta.url).pathname;
const SCRIPT = join(ROOT, "scripts/migrate/seed-logins.mjs");
const EXAMPLE = join(ROOT, "scripts/migrate/logins.example.json");

// Written out here on purpose: the assertions are measured against these literals, not against
// anything lib/auth/session.ts exports — widening the Role contract must not widen this test.
const ADMIN = "admin", STAFF = "staff";
// Clear of the foundation fixture id range (CASE_ID = 90001); personid is smallint.
const PERSON_A = 4101, PERSON_B = 4102, PERSON_MISSING = 4999;

const example = JSON.parse(readFileSync(EXAMPLE, "utf8"));

/** Models Supabase's admin API: createUser writes auth.users, re-registration errors, listUsers pages. */
function fakeAdmin({ registered = [] } = {}) {
  const calls = [];
  const users = [];
  for (const email of registered) {
    const id = randomUUID();
    sql(insertSql("auth.users", { id, email }));
    users.push({ id, email });
  }
  return {
    calls,
    users,
    idFor: (email) => users.find((u) => u.email === email)?.id,
    auth: { admin: {
      createUser: async (attrs) => {
        calls.push(attrs);
        if (users.some((u) => u.email === attrs.email)) {
          return { data: { user: null }, error: { message: "A user with this email address has already been registered" } };
        }
        const id = randomUUID();
        sql(insertSql("auth.users", { id, email: attrs.email }));
        users.push({ id, email: attrs.email });
        return { data: { user: { id, email: attrs.email } }, error: null };
      },
      listUsers: async ({ page = 1, perPage = 50 } = {}) => ({ data: { users: page === 1 ? users.slice(0, perPage) : [] }, error: null }),
    } },
  };
}

const profileCount = () => Number(one(`select count(*) from profiles;`));
const profileRow = (email) => sql(`select id::text, role, coalesce(personid::text,'') from profiles where email = '${email}';`)[0];

before(() => { resetDb(); });
beforeEach(() => {
  sql(`delete from profiles; delete from auth.users; delete from tblbillingnames;`);
  sql(insertSql("tblbillingnames", { personid: PERSON_A, initials: "KP", billingfactor: 1.0 }));
  sql(insertSql("tblbillingnames", { personid: PERSON_B, initials: "DR", billingfactor: 1.0 }));
});

test("logins.example.json has three entries, passes validation, and seeds three profiles", async () => {
  assert.equal(example.length, 3);
  assert.doesNotThrow(() => validate(example));
  assert.doesNotThrow(() => checkPersonIds(example));
  const admin = fakeAdmin();
  const lines = await seedLogins(example, { admin });
  assert.equal(profileCount(), 3);
  assert.equal(admin.calls.length, 3);
  assert.deepEqual(lines, example.map((e) => `${e.email} → ${e.role} (created)`));
  assert.deepEqual(profileRow(example[0].email).slice(1), [ADMIN, String(PERSON_A)]);
  assert.deepEqual(profileRow(example[2].email).slice(1), [STAFF, ""], "a null personid is stored as null");
});

test("role 'owner' aborts before any createUser call (personid is valid, so only the role guard can fire)", async () => {
  const admin = fakeAdmin();
  const entries = [{ email: "a@x.test", role: "owner", personid: PERSON_A }];
  await assert.rejects(() => seedLogins(entries, { admin }), /role must be "admin" or "staff", got "owner"/);
  assert.equal(admin.calls.length, 0, "a user was created for a file with an illegal role");
  assert.equal(profileCount(), 0);
});

test("a personid absent from tblbillingnames aborts before any createUser call (the role is valid)", async () => {
  const admin = fakeAdmin();
  const entries = [{ email: "a@x.test", role: STAFF, personid: PERSON_MISSING }];
  await assert.rejects(() => seedLogins(entries, { admin }), new RegExp(`personid not in tblbillingnames: ${PERSON_MISSING}`));
  assert.equal(admin.calls.length, 0, "a user was created for a file with an unknown personid");
  assert.equal(profileCount(), 0);
});

test("validation is fully up front: a bad THIRD entry still yields zero createUser calls", async () => {
  const admin = fakeAdmin();
  const entries = [
    { email: "one@x.test", role: ADMIN, personid: PERSON_A },
    { email: "two@x.test", role: STAFF, personid: PERSON_B },
    { email: "three@x.test", role: "owner", personid: PERSON_A }, // valid in every other respect
  ];
  await assert.rejects(() => seedLogins(entries, { admin }), /entry 2 \(three@x\.test\)/);
  assert.equal(admin.calls.length, 0, "entries before the bad one were created — validation ran inside the loop");
  assert.equal(profileCount(), 0);
});

test("an unknown personid on the THIRD entry also yields zero createUser calls", async () => {
  const admin = fakeAdmin();
  const entries = [
    { email: "one@x.test", role: ADMIN, personid: PERSON_A },
    { email: "two@x.test", role: STAFF, personid: PERSON_B },
    { email: "three@x.test", role: STAFF, personid: PERSON_MISSING },
  ];
  await assert.rejects(() => seedLogins(entries, { admin }), new RegExp(`personid not in tblbillingnames: ${PERSON_MISSING}`));
  assert.equal(admin.calls.length, 0);
  assert.equal(profileCount(), 0);
});

test("no password is ever passed to createUser — the argument is exactly { email, email_confirm }", async () => {
  const admin = fakeAdmin();
  await seedLogins(example, { admin });
  assert.equal(admin.calls.length, 3);
  for (const attrs of admin.calls) {
    assert.deepEqual(Object.keys(attrs).sort(), ["email", "email_confirm"], `unexpected createUser argument: ${JSON.stringify(attrs)}`);
    assert.equal(Object.keys(attrs).some((k) => /pass/i.test(k)), false, "a password-shaped field was passed");
    assert.equal(JSON.stringify(attrs).toLowerCase().includes("password"), false);
    assert.equal(attrs.email_confirm, true);
  }
});

test("an already-registered second email yields two created and one existing, and reuses that user's id", async () => {
  const admin = fakeAdmin({ registered: [example[1].email] });
  const preId = admin.idFor(example[1].email);
  const lines = await seedLogins(example, { admin });
  assert.deepEqual(lines, [
    `${example[0].email} → ${example[0].role} (created)`,
    `${example[1].email} → ${example[1].role} (existing)`,
    `${example[2].email} → ${example[2].role} (created)`,
  ]);
  assert.equal(profileCount(), 3);
  assert.equal(profileRow(example[1].email)[0], preId, "the existing auth user's id was not reused");
  assert.equal(Number(one(`select count(*) from auth.users;`)), 3);
});

test("a second run creates nothing, leaves three rows, and carries only role/personid changes across", async () => {
  const admin = fakeAdmin();
  await seedLogins(example, { admin });
  const firstId = profileRow(example[1].email)[0];

  const rerun = await seedLogins(example, { admin });
  assert.equal(profileCount(), 3, "a second run of the same file changed the profile count");
  assert.deepEqual(rerun, example.map((e) => `${e.email} → ${e.role} (existing)`));
  assert.equal(admin.calls.length, 6, "createUser is still attempted per entry; only the outcome differs");
  assert.equal(Number(one(`select count(*) from auth.users;`)), 3);

  const changed = example.map((e, i) => (i === 1 ? { ...e, role: ADMIN, personid: PERSON_A } : e));
  await seedLogins(changed, { admin });
  assert.equal(profileCount(), 3);
  assert.deepEqual(profileRow(example[1].email), [firstId, ADMIN, String(PERSON_A)], "a changed role/personid did not land on the same row");
});

test("importing the module creates nobody and writes nothing; the CLI runs only as the entrypoint", () => {
  const env = { ...process.env, MIGRATE_DB_URL: DB_URL };
  const imported = spawnSync("node", ["-e", `import(${JSON.stringify(SCRIPT)}).then(() => process.stdout.write("imported"))`], { encoding: "utf8", env });
  assert.equal(imported.status, 0, imported.stderr);
  assert.equal(imported.stdout, "imported");
  assert.equal(profileCount(), 0);
  assert.equal(Number(one(`select count(*) from auth.users;`)), 0);

  const cli = spawnSync("node", [SCRIPT], { encoding: "utf8", env });
  assert.equal(cli.status, 2, cli.stderr);
  assert.match(cli.stderr, /usage: node_modules\/\.bin\/tsx scripts\/migrate\/seed-logins\.mjs <logins\.json>/);
});
