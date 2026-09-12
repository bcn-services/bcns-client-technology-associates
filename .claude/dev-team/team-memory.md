# Team memory — Technology Associates

Durable gotchas and dead ends, in merge order. Read before planning work that
touches the same area. Never reset.

---

## lane: migration — merged 2026-09-09 (PR #1, merge `a3add4b`, last lane commit `3f65565`)

**A verifier that reads only the export file cannot prove the export is complete.**
`verify.mjs` originally compared database against export. A silently truncated
`mssql-scripter` run scored source=0 / db=0 per table and reported `ok`. Two
acceptance rounds were needed to close it: the first added an `EMPTY` guard, which
still passed a *partially* truncated export. The fix is that verify reads SQL
Server's own per-table counts (`out/source-counts.txt`) and compares three ways.
The flag is mandatory; `--no-source-counts` narrows the check and says so in the
report header, so an archived run is never ambiguous about what was verified.

**`pg_sequence_last_value` is not the next value.** `setval(seq, max, false)` parks
the next value *on* the max id and collides on the first insert, yet reports
`last_value = max`. Any sequence check must read `is_called`, and the report
should print the next value, not the last.

**A sibling signal can mask the guard under test.** Twice this run a mutation
survived because an unrelated mismatch failed the run first — an allow-empty
isolation case exited 1 on an ordinary count mismatch and never reached the
coverage guard. When a mutation survives, suspect the test's setup before the code.

**`mssql-scripter`'s `bin/` wrapper is broken on macOS** — its last line calls
`python`, which does not exist here (only `python3`). Invoke the module directly:
`PYTHONIOENCODING=utf8 ~/.venvs/mssql-scripter/bin/python -m mssqlscripter`.

**`sys.tables` returns mixed-case names** (`tblCase`, `TblScannedDocument`) and
`verify.mjs` matches against a lowercase list. The runbook's counts query must
`LOWER(name)` in both the `WHERE` and the projection, or verify exits 2 at step 5
— after the export has already been generated.

**`EXEC()` takes a variable, not an expression.** `EXEC(STUFF(...) + N'...')` is
invalid T-SQL; assign with `SET` first, then `EXEC(@s)`.

**`load.mjs` creates nothing.** It inserts into tables that must already exist, so
every file in `supabase/migrations/` has to be applied to the target database
first. This was missing from the runbook and would have killed cutover day.

**Deliberate:** `load.mjs` uses per-table `delete from` in reverse dependency order
rather than `truncate`, because `profiles` and `bank_transactions` reference three
of the 20 legacy tables and `truncate` would need `CASCADE` — which reaches outside
this lane's owned paths.

---

## foundation amendment — merged 2026-09-09 (PR #2, merge `2cab8db`, commit `c2b3bf6`)

Reviewer-side amendment to `supabase/migrations/**`, split out of the migration
lane because that path is `protected:`. Landed as a new migration
(`0006_trial_load_fixes.sql`); `0001` was not edited.

**Our schema was stricter than the source in three ways, all found only by loading
the client's real `.bak`, not by reading `LEGACY.md`:**

1. **17 of 19 `bit` columns are nullable in SQL Server**, ours were `not null`.
   2,876 real `tblcase` rows carry a NULL `casestatharddeadline` — load-fatal.
   The rule is that legacy data loads as-is, so the `not null` goes and the
   `default false` stays. Do **not** coerce legacy nulls to false on load.
   `tblcase.billingalert` and `tblactivity.actbilled` really are `not null` at
   source and stay that way — which keeps `0002`'s `actbillid` check two-valued.
2. **SQL Server `real` needs `numeric(9,3)`, not `numeric(8,2)`.** Seven
   `srvauthhours` rows need the third decimal; `numeric(8,2)` rounded them and the
   column sums then disagreed.
3. **`tblcase.casestatusharddeadline` was a phantom** duplicating
   `casestatharddeadline` — it exists in no source table. Dropped.

**Lesson for any future schema derived from a legacy database: nullability and
numeric width must come from `sys.columns`, not from a written spec.** A trial
load against the real backup is the only thing that finds this class of defect.

**`scripts/migrate/out/` and `in/` are now in the root `.gitignore`.** They were
only covered by `scripts/migrate/.gitignore`, which does not exist on `integration`
— a `git add -A` on a foundation branch staged ~200 verify reports containing real
client data. Caught before commit. The rule now survives on any branch.

## 2026-09-09 21:20 — dev-team-auto — Seed script tests/app-shell/seed-e2e.ts
- **Outcome:** DONE — 1 attempt — caution: no — team: dt-engineer (opus/medium) — branch item/seed-e2e, commit 25b7b81
- **What happened:** Built the idempotent e2e account seeder: `createUser({email_confirm:true})`, falling back to a `listUsers()` scan + `updateUserById` on "already registered", then a `profiles` upsert on `id`. Single attempt, no rework.
- **What worked:** Reusing `createServerClient()` from `lib/db/client.ts` instead of building a service-role client — satisfies the `getConfig()` guardrail for free. Proving idempotency by running the script three times and asserting one auth user + one profiles row, rather than inspecting the branch.
- **What failed:** none
- **Remember next run:** (1) `pnpm exec tsx` does NOT load `.env.local` and nothing else in this repo does — a script run outside Next.js needs its own loader or it fails as "not configured"; the seed exports `loadEnvLocal()` for the next script to reuse. (2) package.json has no `"type": "module"`, so tsx transpiles to CJS and **top-level await fails to transform** — use a promise chain in any CLI entry. (3) auth-js 2.116 has no `getUserByEmail`; the only lookup-by-email is paging `auth.admin.listUsers()`. (4) A fresh worktree has no `node_modules`; `pnpm install --frozen-lockfile` needs `GITHUB_TOKEN` exported for `.npmrc` or every command spews a token-substitution WARN. (5) Copy `.env.local` into each new worktree before running anything.

## 2026-09-09 23:05 — dev-team-auto — middleware.ts auth boundary + route gate
- **Outcome:** DONE — 3 attempts — caution: yes — team: dt-engineer opus/medium, dt-qa opus/medium, dt-review opus/medium — item/auth-middleware, 3d5d980
- **What happened:** Built root middleware.ts as gate(request, bind) + bindSupabase(request) so the gate is unit-testable with a fake. QA attempt 1 found an auth bypass (matcher extension regex skipped /cases/<id>.js entirely); fixed by using literal prefixes. Review then found 4 Important: open redirect via `//` in next=, deny() dropping rotated cookies, no timeout on Supabase awaits, and two round trips per request. The first three were fixed and verified live; the fourth was accepted.
- **What worked:** QA running the real config.matcher regex in a dependency-free node --test file; a live Supabase throwaway user (service-role create, then delete) to prove refreshed Set-Cookie; role-parity.test.mjs running the same profile rows through both gate() and getSession() so the inline role check can't drift.
- **What failed:** A matcher pattern (not a literal) decided whether the auth boundary runs, which caused the bypass. The engineer died mid-attempt-3 when the laptop slept (uncommitted tree kept and verified). The shared lane node_modules, symlinked into the item worktree, got wiped twice by a concurrent session and corrupted one gate/build run.
- **Remember next run:** Give each item worktree its own real `pnpm install` (store-backed, ~3s), never a symlink to the lane's node_modules. config.matcher exclusions must be escaped, $-terminated literals, and a future public/ dir needs a literal prefix, never an extension pattern. Next normalizes `//x` to `/x` before middleware, so the next= guard is defense-in-depth. The login page (next item) must still validate next= itself. Middleware makes 2 Supabase calls per request; a JWT role claim (migration, out of lane) would halve that.

## 2026-09-09 23:34 — dev-team-auto — login page + signout route
- **Outcome:** DONE — 1 attempt — caution: no — team: dt-engineer opus/medium — item/login, 1e17d4e
- **What happened:** Added lib/auth/safe-next.ts (`/^\/(?![\/\\])/` plus a control-character reject), a login server action whose failure path redirects to `/login?error=invalid&next=<validated>` with no credentials in the URL, a POST-only /signout route that returns a 303 to /login, a safe-next unit test, and tests/app-shell/login.live.test.mjs. The orchestrator re-ran the gate, the live test and the mutation checks itself: 4 RED, 0 SURVIVED.
- **What worked:** A live test on real HTTP against `pnpm dev` on port 3100, run after `pnpm exec tsx tests/app-shell/seed-e2e.ts`. It asserts Location headers, `sb-*-auth-token` Set-Cookie, cookies cleared after signout, and a 307 to /login afterwards. For mutation checks, edit with sed while the dev server hot-reloads, then `git checkout -- lib app`.
- **What failed:** none. The live test failed 3 of 6 once, while the 73-test gate suite ran at the same time against the same Supabase project. Run it alone.
- **Remember next run:** login.live.test.mjs skips itself when no server is running, so a gate run without a server does not cover wrong-password cookie handling or signOut(). Start dev and seed before relying on it. Next's route announcer also has `role="alert"`, so find the login error by its text, not by role. A signed-in user who opens /login is not redirected away (the task didn't ask for it), so a later item may want that.

## 2026-09-09 23:47 — dev-team-auto — item 4: app shell layout + nav
- **Outcome:** DONE — 1 attempt — caution: no — team: dt-engineer (opus/medium) — item/app-shell, 73e9dea
- **What happened:** Built the header in the root layout (nine sections from the new `lib/auth/sections.ts`, Account, admin-only Users, email and role, POST /signout form), the landing page, and a not-found page inside the shell. The Tailwind move in `globals.css` is included. The new `tests/app-shell/shell.live.test.mjs` signs in as staff and as a throwaway admin over live HTTP. The engineer passed on its first attempt, and the orchestrator re-verified everything by running it.
- **What worked:** The staff check looks at the raw HTML, including Next's embedded page data, for any `/users` text. The layout wraps `getSession()` in try/catch so a failure shows nothing. All four mutations went red on the live test with dev hot-reload, restoring each file with `git checkout` after (the tree was committed first).
- **What failed:** none.
- **Remember next run:** The nav lives in the layout, so "remove the nav from not-found" can't be mutated directly; deleting `not-found.tsx` is the check that stands in for it. `/` calls `getSession()` twice (layout and page), which React `cache()` would cut to one. The layout has no timeout on `getSession()`, unlike the 2s one in middleware. `/login` still uses inline styles, not Tailwind.

## 2026-09-10 00:00 — dev-team-auto — /users admin list + account creation (item 5)
- **Outcome:** DONE — 1 attempt — caution: no — team: dt-engineer opus/medium — item/users-create, commit 1103778
- **What happened:** The list and create form live in `app/(auth)/users/` (page.tsx, actions.ts, create-form.tsx). The account-creation logic is in `lib/auth/users.ts` and takes the service-role client as a parameter, so tests can pass in a fake. The temporary password comes back from a server action through `useFormState` (Next 14.2), with no redirect, cookie or query string. If the profiles insert fails after the auth user is created, the auth user is deleted. A duplicate email shows an "already exists" error and leaves the existing account untouched.
- **What worked:** A live test captures the admin's real create-action request (`next-action` header + body) and replays it with a staff cookie. That proves the admin check inside the action without having to decode Next's action-ID format. An admin replay runs first as a control, so a broken replay can't pass as a refusal.
- **What failed:** In the first live run, 14 tests skipped because the tests check whether the server is up once at import, and the cold dev server hadn't compiled yet. Warm the server (curl /login and /api/health) before running live tests. My first `?pw=` mutation went red only on a TimeoutError, because the password never rendered. Re-running it with the page also rendering `searchParams.pw` made the "password in URL" assertion itself fail.
- **Remember next run:** Staff get a 500 on admin pages until an `app/error.tsx` maps ForbiddenError to a 403, so item 6 or a polish item should add one. Item 6 can add per-row actions using `data-user-id` on each row of the /users table, and new server actions go in `actions.ts` with `requireSession('admin')` first. The `server-only` package is not installed, so server-only is kept by convention (`create-form.tsx` imports only the action).

## 2026-09-10 00:14 — dev-team-auto — item 7: /account change own password
- **Outcome:** DONE — 1 attempt — caution: no — team: dt-engineer opus/medium — item/account, 973d8e9
- **What happened:** Built app/(auth)/account/page.tsx, actions.ts and password-form.tsx, following the useFormState pattern from item 5. The server action gets the user and the re-auth email from requireSession(). It checks empty fields, that new matches confirm, a minimum of 8 characters, and that new differs from current, then calls signInWithPassword and then updateUser. There are 5 live tests in tests/app-shell/account.live.test.mjs, using throwaway @example.test accounts that are deleted in after(). The orchestrator re-ran the gates and ran the mutation checks itself: 4 RED, 0 SURVIVED.
- **What worked:** A crafted server-action POST replayed with injected email and id fields tests "never accepts a target user id". A 429 on re-auth gets its own "Too many attempts" message instead of a false "wrong password". The live tests retry with backoff on a 429 and never count it as accepted or rejected.
- **What failed:** The first crafted-POST test passed even with the email-from-form mutation in place. Next only reads the form fields that come before the trailing "0" part, so fields appended at the end were ignored. The test now inserts them before the real fields and asserts they were inserted.
- **Remember next run:** Two items working in parallel on one Supabase project run into auth 429s, so live sign-in checks need retry/backoff. `next dev` shows up as `next-server` with no path in its command line, so find which one is yours by its cwd (`lsof -a -p PID -d cwd`), not by grepping `ps`. app/(auth)/login/actions.ts turns every error, including a 429, into `error=invalid`, which tells a rate-limited user their password is wrong. That's a lane follow-up. Changing a password doesn't sign out the user's other sessions (Supabase keeps refresh tokens valid). That's deferred and can be added if the admin temp-password flow needs it. A mutation loop of 4 live runs takes more than 10 minutes, so run it in the background from the start.

## 2026-09-10 00:13 — dev-team-auto — item 6: /users role change + deactivate + billing-person
- **Outcome:** DONE — 2 attempts — caution: yes — team: dt-engineer opus/medium+high, dt-qa opus/medium+high, dt-review opus/medium+high — item/users-manage, e14535b
- **What happened:** Built role change, deactivation (delete profiles row only, auth user kept) with self and last-admin guards, and the tblbillingnames→personid dropdown. QA passed attempt 1, but review found 2 Important: a self-deactivation bypass using an uppercase uuid, and a delete that didn't re-check the role it had read. Attempt 2 fixed both plus 5 Minor, with a red-when-removed test for each.
- **What worked:** Last-admin race handled without a migration: pre-check ≥2 admins, a role-conditional write, then recount and undo if zero, with a failed undo detected by rows affected. Mutation-checking every guard caught nothing missing. Staff-replay live tests now also assert a clean "Admins only." 200 body.
- **What failed:** Attempt-1 guards compared raw form strings to session ids, and Postgres uuid matching ignores case, so the self guard was bypassable. Compare against the id loaded from the database. The delete lacked `.eq("role", row.role)`, so a promotion between read and write skipped the guard. Staff replays returned HTTP 500 until ForbiddenError was caught in each action.
- **Remember next run:** The `pnpm dev` script hard-codes `-p 3100` and ignores PORT, so use `pnpm exec next dev -p <port>`. With a single admin, "last admin refused" can only happen as self-deactivation, so prove it through a fake client. Live admin-count tests skip themselves when a concurrent run holds admin. Tell dt-review not to write repo-root files (it created STANDARDS.md, which is unowned). The /users staff error page (`error.tsx`) is still missing.

## 2026-09-10 — polish pass (inline, after the supervised hand test) — 5 items
- **Outcome:** DONE — 5 polish items, 1 attempt each — caution: no — team: orchestrator inline (opus), no subagents — lane/app-shell
- **What happened:** A 9/9 hand test plus the lane-acceptance Minors gave 5 small fixes. (1) The gate redirects a denied POST with 303 and makes /signout public. (2) /users and createUserAction give staff an "Admins only." refusal, not a 500. (3) Login checks the profiles row after sign-in and signs a deactivated account out with a message. (4) createStaffUser reactivates an auth user that has no profiles row; a 23505 conflict still means "already exists". (5) /login uses Tailwind.
- **What worked:** Inline beat parallel Sonnet subagents. The fixes were small, and the live tests share one Supabase project and port, so verification would be serial anyway. A cold subagent start costs ~40–60k tokens each. Reactivation checks the primary-key conflict on insert (23505) instead of doing a separate select. Every guard went red under a mutation: 4 unit, 3 live.
- **What failed:** none.
- **Remember next run:** @supabase/ssr 0.12 caches set cookies in memory (setItems), so a server action can query as the user right after signInWithPassword on the same client. The staff-/users live test now expects a 200 "Admins only." page, not a non-200. For mutation checks on uncommitted work, restore from a backup copy, never with `git checkout --`.

## 2026-09-11 18:37 — dev-team — lane/cases item 1: firms, attorneys, clients
- **Outcome:** DONE — 1 attempt — caution: no — team: dt-engineer opus/medium (via dt-orchestrator opus/medium) — item/contacts, 1cb272c
- **What happened:** Built list/create/edit screens for firms, attorneys and clients, the five legacy presets (ported from Access MSysQueries via mdbtools), and an idempotent hosted fixture seeder. The engineer self-verified; the orchestrator re-ran the gate and all 9 mutations (a, b1–b5, c×2, d), and all went red.
- **What worked:** Reading the legacy queries straight from the .accdb with mdbtools. A SQL-level preset test on a private local DB compares each preset with the legacy query translated to Postgres. A grep-based no-delete test. A perl-in-place mutation script with cp backup and cmp restore.
- **What failed:** Plain `pnpm test` goes red (58 failures) when parallel worktrees drop and recreate the shared `ta_foundation` DB mid-run. Nothing wrong with the code.
- **Remember next run:** Run `pnpm test` with `FOUNDATION_PG_URL` pointed at a private DB (createdb ta_<item>_gate) while other lanes or items run. The Access form layouts can't be read with mdbtools, so labels are unverified against legacy. Live contact tests leave "Contacts Live <tag>" rows in the hosted DB (no delete path). Presets join whole tables in JS (a ponytail comment marks it); move them to a view if tblcase grows past about 50k rows.

## 2026-09-11 — dev-team — lane/cases item 3: case search and lists
- **Outcome:** DONE — 1 attempt — caution: yes — team: dt-engineer opus/medium, dt-qa opus/medium, dt-review opus/medium (via dt-orchestrator opus/medium) — item/case-search, eb0a58c — QA PASS, review 0/2/6
- **What happened:** Built /cases quick search, /cases/search advanced search (AND/OR, checked fields only), newest/roster/title lists and /cases/[id]/label over case_search. QA PASS on the first attempt; review 0/2/6. Both Importants were closed by QA's e2e test and the merge-time package.json step, so no fix pass.
- **What worked:** OR values double-quoted in PostgREST .or() with \ and " escaped, plus escapeLike for %/_. QA's test runs the real runSearch/listCases through a fake client that turns each PostgREST call into SQL on a private copy of local PG, and it refuses to run on ta_foundation. Lists read tblcase without joins and fill names from the view by id, so orphan cases stay visible.
- **What failed:** Shared ta_foundation is reset by sibling worktrees mid-run (4–39 spurious failures), so the gate needs a private DB. The engineer's first live tests used hand-written SQL, not the app's real queries (review I2).
- **Remember next run:** Always point FOUNDATION_PG_URL at a private createdb copy, and drop it after. case_search has no caseid::text, so case # is exact-match only (foundation amendment to add it). PostgREST turns a typed * into a like wildcard and it can't be escaped. The case lists also read case_search, so on hosted they fail too until 0007 is pushed. Search-error detection matches /case_search/ loosely; narrow it to PGRST205/42P01. Deferred Minors: repeated ?q= key → array → 500; raw DB errors shown to user; serial status-list + search reads; AND search mixing view/tblcase fields intersects 1,000-row pages in memory.

## 2026-09-11 18:38 — dev-team-auto — lane/cases item 2: inquiries
- **Outcome:** DONE — 2 attempts — caution: no — team: dt-engineer (opus/medium), dt-engineer (opus/high) — item/inquiries, 7d38ca9
- **What happened:** Built `/inquiries` (quick, advanced and 2 presets), `/new` and `/[id]` edit, with a marked spot for item 8's convert, and all logic in `lib/inquiries/inquiries.ts` taking an injected client. Attempt 1 guessed the 16 quick-search fields because the Access file hadn't been found yet. A later disk search found `~/Downloads/TA_Files/DB_Technology_Associates.accdb`, and `mdb-queries` plus a UTF-16LE decode of its form value lists gave the real `InquirySearchQuery` and the engineer, how-heard, subject and client-role lists. Attempt 2 matched them.
- **What worked:** The Access front-end is readable with mdbtools (`mdb-queries <file> <QueryName>`). Combo value lists come out of a UTF-16LE decode as `"a";"b";...` strings. For id and inqdate, which PostgREST can't ilike, the search matches substrings in JS over an `id, inqdate` scan and ORs the hits in as `id.in.(...)`. The live test has one assertion per field, so a dropped field fails by name. 13 of 13 mutations went red.
- **What failed:** Attempt 1 built on guessed legacy definitions. In attempt 1, dropping a sent column survived its mutation because the tests looped over the module's own constant; pinning the lists as literals in the tests fixed it. On a cold dev server the middleware's 2s session check once bounced an edit POST to /login.
- **Remember next run:** Run the full disk search for the Access files (`~/Downloads/TA_Files/*.accdb`) before the first spawn, never while the engineer is already building. That front-end holds the query SQL and form value lists that LEGACY.md leaves out (it contains real data, so extract only definitions). Gate with `FOUNDATION_PG_URL` set to a private DB. Warm the dev server with one throwaway live run first. How-heard has 15 values in the current form, not 14. Client role stores "Other (see notes)".

## 2026-09-11 19:10 — dev-team-auto — lane/cases item 5: case presets
- **Outcome:** DONE — 1 attempt — caution: no — team: dt-engineer opus/medium — item/case-presets, 50467dd
- **What happened:** Ported Work Status (base + COPY sort variants, print sheet), qryWaitingFor, OtherExpertsSearch and the three case-lane sources of Query_DatabaseActivity into lib/cases/presets.ts with screens under app/cases/lists/. Legacy SQL was pulled from the Access file's MSysQueries with mdbtools (mdb-queries drops joins and GROUP BY; the join flags and UNION text are in MSysQueries rows, via mdb-json). Engineer self-verified, then the orchestrator ran all 8 mutation checks and every one went red.
- **What worked:** SQL-parity tests that drive the real preset functions through a fake client that translates PostgREST calls to SQL on a private DB (ta_presets_gate), next to the legacy query translated to Postgres; "today" injected (pinned 2026-06-15) for the 35-day window; sorting in JS because PostgREST can't order by lower(text) or "is null"; one reusable mutation script (cp backup, perl -0pi edit, run the two test files, restore, byte-compare).
- **What failed:** none. Mutation (b), dropping the null-priority filter, gives the same rows at the SQL level (NOT LIKE already excludes null), so only the unit filter-call assertion catches it.
- **Remember next run:** Access file is at ~/Downloads/TA_Files/DB_Technology_Associates.accdb (use mdfind; `find ~` takes over 2 min). Legacy qryWaitingFor is a LEFT JOIN with GROUP BY and a null sum; the lane asks for 0. Query_DatabaseActivity has 6 more sources (new_case, inquiry, income, expense, bill, new_bill) that the inquiries, money and billing lanes can reuse; each uses a strict `> Date()-35`. The recent-activity cutoff is compared in the DB session timezone (UTC), not Hartford midnight (ponytail note in the code).

## 2026-09-11 — dev-team-auto — lane/cases item 4: case record (/cases/[id])
- **Outcome:** DONE — 3 attempts — caution: yes — team: dt-engineer opus medium/high/xhigh, dt-qa opus medium/high/xhigh, dt-review opus high/xhigh — item/case-record 79dc25a — QA PASS, review 0/3/4 then 0/0/2
- **What happened:** Built the /cases/[id] record, the save server action, the rolodex view and 17 new tests. Attempt 1: QA found a stale form reverting other users' columns because the save diffed against the row as it was at save time. Attempt 2 fixed that with hidden `<col>__orig` inputs, but QA and review both found that single-line inputs drop legacy newlines and so trigger spurious writes. Attempt 3 compares single-line fields with newlines stripped on both sides; QA PASS, review 0/0/2.
- **What worked:** diffing the submitted form against the values it was loaded with (hidden __orig), with only allow-listed columns reaching the update; QA's out-of-band-change stale-editor test driven through the real server action; seeding a row with values a browser would alter (CRLF, leading/trailing spaces, leading textarea newline, off-list point man) and checking that an untouched save leaves it identical.
- **What failed:** diffing against the row re-read at save time (reverts concurrent edits); single-line <input> newline stripping; QA's own test that sent no __orig passed without testing anything until review caught it; the engineer's live test left an invented "Low" priority in the hosted lookup table.
- **Remember next run:** every test formFor for an edit form must send `__orig` or it proves nothing. Test helpers that add lookup values to the hosted database must remove leftovers at setup, and must re-point FK rows before deleting. Classifier blocks reading form labels out of the legacy accdb (treated as PII handling); get a human check or permission. tests/cases is not in `pnpm test` yet, so run it separately.

## 2026-09-11 20:10 — dev-team-auto — lane/cases item 6: new case
- **Outcome:** DONE — 1 attempt — caution: no — team: dt-engineer opus/medium — item/new-case, 63e5e42
- **What happened:** Built /cases/new with lib/cases/create.ts (nextCaseId, insertCase, createCase, safeReturnTo, returnWith), and added returnTo to the attorney/client create screens. The engineer self-verified in one attempt; the orchestrator mutation-checked (a) through (g), all red on the intended assertion.
- **What worked:** The concurrency test runs each insert in its own psql process inside an open transaction lasting 0.4s, so the primary key really decides the race. Unit tests pin the defaults and returnTo cases as literals.
- **What failed:** The first build hit the status foreign key on hosted, whose tblcasestatus has only "Active". Fix: default "Open" only when the status list has it. Mutation (d) first crashed because the fake PostgREST-to-SQL client has no .eq; redone as a pre-check against nextCaseId, it then went red on the concurrency test.
- **Remember next run:** The fake SQL client in create-sql.test.mjs supports only select/order/limit/insert. Mutations that need .eq must be phrased some other way. Dropping caseid makes the fake client fail with `column "nan"`, so the unit payload test is the real guard for the explicit caseid. Hosted tblcasestatus lacks "Open", so check the real legacy status list before item 8 relies on it.

## 2026-09-11 20:30 — dev-team-auto — lane/cases item 7: service authorizations
- **Outcome:** DONE — 2 attempts — caution: yes — team: dt-engineer opus/medium→high, dt-qa opus/medium→high, dt-review opus/medium→high — item/service-auths 8bc4d72 (code e66476b) — QA PASS (delta), review 0/1/6 (Important + 4 Minors fixed)
- **What happened:** Built the service-auth panel on /cases/[id] (add/edit, `__orig` diff-only writes, transition-only approval stamp using the Hartford date, hours kept as a string with 3 decimals) and 4 lists/totals ported from qryServAuthAwaitingApproval / qryServAuthApproval / qryServAuthApproved / qrySrvAuthTotal. QA failed attempt 1: after the add redirect, a row form took a neighbour's Status value, so an untouched Update approved and stamped the row. Attempt 2 fixed it and delta QA passed.
- **What worked:** Pinned-clock unit tests (2026-09-12T02:00Z → 2026-09-11), live tests through the real server action with notes-tagged rows removed by the service role at setup and teardown, and per-guard mutation checks. QA's mutation run found that the "approval date already set in `__orig`" guard had no test covering it.
- **What failed:** Keying server components did nothing: Next 14.2's React canary drops keys on server components, so row forms were matched by position. The key had to go on the `<form>` element. Review also caught Add having no double-submit protection, which matters because a duplicate row can't be deleted. A button named "Save authorization" broke item 4's `name: "Save"` Playwright substring matches.
- **Remember next run:** In this repo, put list keys on an HTML element or a client component, never on a server component. Playwright button names match by substring, so avoid "Save …" labels near item 4's form. Rows with no delete control need a `useFormStatus` disabled submit button. `useFormStatus` isn't in plain react-dom 18.3.1, so unit tests must stub it. The service-auth lists read every row with ordered 1000-row pages and join in JS (marked `ponytail:`), and "Recently approved" has no limit yet. Legacy "Recently approved" sorted oldest first; this build sorts newest first. The form layout for frmCaseServAuth wasn't in mdbtools, so the status list came from LANE.md.

## 2026-09-11 21:38 — dev-team-auto — lane/cases item 8: convert inquiry to case
- **Outcome:** DONE — 1 attempt — caution: no — team: dt-engineer opus/medium — item/convert-inquiry, bb82baf — journey 02 PASS
- **What happened:** Built convertInquiry (lib/inquiries/convert.ts) reusing item 6's nextCaseId/insertCase, a separate ConvertPanel client form with a useFormStatus-disabled button, and convertInquiryAction redirecting to /cases/<id>. The orchestrator re-ran the gate and journey 02 (pass), checked on hosted that case 90003 has caseinquiry=29, attorney 1, client 1, status Open, branch Hartford, that the inquiry page shows 0 convert buttons plus a link to /cases/90003, and that the record shows the firm, Pat and Sam.
- **What worked:** A pure function taking an injected db plus fake-client tests with one named test per guard, so all 9 mutations (a)–(i) went red on the first try. Compensation = insert the case first, update the inquiry second, delete the case with the service-role client if the update fails.
- **What failed:** none. The journey's strict-mode getByText(/firm|attorney|client/i) worries did not happen.
- **Remember next run:** Hosted tblcasestatus lacked "Open". ensureOpenStatus in tests/cases/seed-fixtures.ts added an invented "Open" row; app code refuses to convert when the status is missing. tblcase.tabranch is NOT NULL and journey 02's inquiry has no branch, so convert needed a "Case branch" picker (defaults to the inquiry's branch, else the only branch). Hosted case numbers are 90002+ (> 32767), so inqresultingcase is never written on hosted; the "already converted" check must look up tblcase.caseinquiry. playwright.config.ts has no webServer: start `next dev -p 3100` yourself; the E2E login falls back to staff@example.test/password. tests/app-shell/shell.live.test.mjs "signed-in GET /cases → 404" is stale and fails whenever a server is up on 3100.

## 2026-09-11 22:10 — dev-team-auto — lane/cases item 9: wire cases into app shell
- **Outcome:** DONE — 1 attempt — caution: no — team: dt-engineer opus/medium — item/shell-wiring, 2f6b767
- **What happened:** `lib/auth/sections.ts` gains `{href:"/inquiries",label:"Inquiries"}` after Cases (comment now "ten"); `app/page.tsx` gains two plain GET search forms (`/cases?q=`, `/inquiries?q=`); `tests/cases/shell-wiring.test.mjs` adds 6 source assertions and 1 live HTTP check (skips without a server).
- **What worked:** Mutations (remove Inquiries, change its href, swap each form's action, rename each input) each turned the expected assertion red. Removing /time turned `shell.live`'s staff and admin header tests red, so that guardrail holds. Every restore was byte-identical.
- **What failed:** none. The `shell.live` "signed-in GET /cases → 404" test predates this item and now fails whenever a server is up (see Needs amendment).
- **Remember next run:** `shell.live` checks nav hrefs with includes(), so adding sections doesn't break it. The admin header uses the same SECTIONS list. On hosted, `/cases?q=` shows the missing-view alert until 0007 is applied. Gate DB clones with `createdb -T ta_foundation`.
