# Technology Associates — Lane: app-shell

## Objective

Staff sign in with their real account and land in a navigable, role-aware app
shell that every later lane's screen sits inside.

Lane done when:
- A seeded staff account signs in at /login and reaches a home page showing
  their email and role; a wrong password shows an error and no session
- An unauthenticated request to any non-public route lands on /login and,
  after signing in, on the route that was asked for
- Every nav entry is present and points at its route, and admin-only entries
  are absent for a staff account
- Sign out clears the session; the protected route is unreachable again

Status: nothing built yet. `main` carries `/foundation` only (frozen schema,
generated types, `Session`/`Role`, six red journeys). A Supabase project is
provisioned before this run; every item except the app shell needs it.

Precondition — the deferred foundation/map amendment must land on `main` and
this branch must rebase onto it before `/dev-team-auto` runs: `middleware.ts`
and `app/not-found.tsx` move into this lane's `owns:` in MAP.md, and the
Tailwind 3.4 toolchain (config, postcss, deps) is installed. Items 2 and 4
assume both. Deferred so the live `lane/migration` run is not rebased mid-flight.

Lane: app-shell — auth, admin/staff roles, layout, nav, home page

Owned — this lane's items live inside these paths:
  app/layout.tsx, app/page.tsx, app/globals.css, app/not-found.tsx,
  app/(auth)/**, lib/auth/**, middleware.ts, tests/app-shell/**

Open — merged lanes. Wiring items may edit these; rebase onto `integration` first:
  none — no lane has merged yet

Stop and report if an item requires changing a path outside both lists:
  protected — supabase/migrations/**, lib/db/**, lib/auth/session.ts,
    lib/auth/client.ts, lib/env.ts, scripts/gen-db-types.mjs,
    tests/foundation/**, tests/journeys/**, playwright.config.ts,
    tsconfig.foundation.json
  an unmerged lane's — scripts/migrate/**, tests/migration/**, app/cases/**,
    app/firms/**, app/attorneys/**, app/clients/**, app/inquiries/**,
    lib/cases/**, lib/contacts/**, lib/inquiries/**, tests/cases/**,
    app/time/**, lib/time/**, tests/time/**, app/bills/**, lib/bills/**,
    tests/billing/**, app/expenses/**, app/funds/**, app/bank-review/**,
    lib/expenses/**, lib/funds/**, lib/bank-import/**, tests/money/**,
    app/documents/**, app/reports/**, app/dashboard/**, lib/documents/**,
    lib/reports/**, lib/storage.ts, tests/docs-reports/**
  unowned — repo root config (package.json, pnpm-*.yaml, tsconfig,
    next/eslint/tailwind/postcss config, *.md), .github/workflows,
    .claude/worktrees, app/api/health, lib/health.ts, lib/ai.ts,
    lib/webhooks.ts, tests/*.test.mjs

Frozen contracts — build and test against these; they will not move:
  none — this lane has no `depends on:` edges. It consumes the frozen
  `lib/auth/session.ts` and `lib/db/types.ts` as a reader, never an editor.

Test against the fixture, not the producing lane. Do not wait for it to exist.

## Global rules

- Copy `.env.local` into the worktree before running any item. It is gitignored,
  so a fresh worktree has no Supabase keys and `createUserClient()` returns
  null — which presents as "not signed in", not as a configuration error.
- Every account this lane creates (seed script or admin screen) goes through the
  service-role admin API with `email_confirm: true`. The project has no mailbox
  and no SMTP; an unconfirmed account can never sign in.
- `lib/env.ts` stays the only `process.env` reader.
- The app must still build and serve with no environment variables set.
- Seeds and fixtures use invented data only — never a real client, attorney, or
  staff member's credentials.
- Context: `CLAUDE.md`, `CLIENT.md`, `FOUNDATION.md`, `MAP.md`.

## Not yet specified

- Whether Jon needs a narrower role than `staff` — CLIENT.md lists "Staff list +
  per-person access" as an open question with the client. Ask Kris before
  go-live; a third role is a foundation amendment, not a lane item.

## Out of scope

- Magic-link / passwordless sign-in — needs custom SMTP the project does not
  have, and would amend the protected journey helper.
- Forgot-password self-service email — no outbound email in v1; recovery is an
  admin resetting the password from /users.
- Invite-by-email — same reason; admins create accounts with a temporary password.
- Grouped nav (Money as one menu) — flat entries this round, frontend polish deferred.
- A real work dashboard at `/` — `app/dashboard/**` belongs to lane docs-reports.
  The landing page is identity + nav, shaped to grow into it later.

---

- task: Seed script `tests/app-shell/seed-e2e.ts` — idempotently creates the
    end-to-end test account the six journey specs log in as. Reads `E2E_EMAIL` /
    `E2E_PASSWORD` with the same defaults `tests/journeys/helpers.ts` uses
    (`staff@example.test` / `password`), creates the auth user through the
    service-role admin API with `email_confirm: true`, and inserts its `profiles`
    row with `role: 'staff'` and `personid` null. Run it with
    `pnpm exec tsx tests/app-shell/seed-e2e.ts` — do not add a package.json
    script, package.json is unowned root config.
  guardrails:
    - Idempotent — a second run must not create a duplicate auth user or throw
    - Never write a real person's email or password into the seed
    - Service-role config comes from `getConfig()`; no direct `process.env` read
  done when:
    - Running the script against a configured project creates the auth user and its profiles row; a second run exits 0 leaving exactly one of each
    - The created account signs in via `signInWithPassword` immediately, with no pending confirmation step
    - With no Supabase environment set the script exits non-zero naming the missing variable, rather than throwing a null-reference
  status: done — commit 25b7b81
  parallel-group: a

- task: `middleware.ts` at the repo root — Supabase SSR session refresh over the
    request/response cookie pair, plus the route gate. A request whose path is not
    in the public allowlist and carries no valid session redirects to
    `/login?next=<pathname + search>`. Public allowlist: `/login`, `/api/health`,
    and Next internals (`/_next/*`, favicon, static assets), expressed in
    `config.matcher`. This is the app's only authentication boundary — every later
    lane's screen is protected by this file and nothing else.
  guardrails:
    - Fail closed — if the session cannot be determined for any reason, redirect to /login; never fall through to the page
    - Never import from or edit `lib/auth/session.ts` or `lib/auth/client.ts`; both are protected contracts
    - The allowlist is an explicit set of paths, never a prefix match against user-controlled input
  done when:
    - An unauthenticated GET of `/cases/90001` redirects to `/login?next=%2Fcases%2F90001`
    - An unauthenticated GET of `/login` and of `/api/health` return 200 with no redirect
    - A request carrying a valid session cookie for a user with a profiles row reaches the page, and the response carries refreshed auth cookies
    - Existing passing tests remain passing
  caution: true
  status: done — commit 3d5d980
  parallel-group: a

- task: `app/(auth)/login/page.tsx` with a server action calling
    `signInWithPassword` on `createUserClient()`; on success redirect to the
    `next` query param when it is a relative path, otherwise `/`. On failure
    re-render with a visible error and no session. Plus
    `app/(auth)/signout/route.ts` — POST calls `signOut()` and redirects to
    `/login`. The email and password fields and the "Sign in" button must match
    what `tests/journeys/helpers.ts` queries for; that file is protected and
    cannot be changed to suit this screen.
  guardrails:
    - `next` must be a path beginning with a single `/` — an absolute URL or protocol-relative `//host` falls back to `/`
    - Never log, echo back, or place a password in a URL, redirect, or error message
    - Do not change the field labels or button name the protected journey helper depends on
  done when:
    - Correct credentials sign in and land on the path given by `?next=`; `?next=https://example.com` and `?next=//example.com` both land on `/`
    - A wrong password re-renders the login page with a visible error and sets no session cookie
    - POST to /signout clears the session, and a following request to a gated path redirects to /login
    - Existing passing tests remain passing
  status: done — commit 1e17d4e

- task: The app shell — `app/layout.tsx` renders a header with the nine section
    nav entries (Cases /cases, Time /time, Bills /bills, Expenses /expenses,
    Funds /funds, Bank review /bank-review, Documents /documents,
    Reports /reports, Dashboard /dashboard), an Account entry (/account), an
    admin-only Users entry (/users), the signed-in email and role, and a sign-out
    control posting to /signout. `app/globals.css` moves to Tailwind.
    `app/page.tsx` replaces the template's pricing demo with the signed-in
    landing (identity + section links). `app/not-found.tsx` renders inside the
    shell so the not-yet-built sections stay navigable.
  guardrails:
    - Nav entries are plain links — never import a lane's `lib/` module that does not exist yet
    - The Users entry must be absent from the markup for a staff session, not hidden with CSS
    - No template placeholder copy about plans, seats, or pricing survives in `app/page.tsx`
  done when:
    - Signed in as staff, the header shows the user's email and role and links to the nine section routes plus /account, and /users appears nowhere in the markup
    - Signed in as admin, the same header additionally links to /users
    - Visiting /cases renders the not-found page inside the shell with the nav present and usable, not Next's default 404
    - Existing passing tests remain passing
  status: done — commit 73e9dea

- task: `app/(auth)/users/page.tsx` — the admin user list and account creation,
    gated by `requireSession('admin')`. Lists every `profiles` row with email,
    role, and linked initials. A create form takes an email, generates a
    temporary password with `crypto.randomBytes`, creates the auth user through
    the service-role admin API with `email_confirm: true`, inserts the profiles
    row, and displays the temporary password once on the resulting page for the
    admin to read to the person.
  guardrails:
    - The temporary password is generated with `crypto.randomBytes`, never `Math.random`
    - The service-role client is constructed and used only in server code; never imported into a client component
    - The temporary password is never stored in `profiles`, logged, or emailed — it appears once in the response and nowhere else
  done when:
    - A staff session requesting /users is refused with a ForbiddenError; an admin session renders the list
    - Creating a user with a new email produces both an auth user and a profiles row, and that person signs in with the displayed temporary password with no confirmation step
    - The temporary password appears exactly once, on the page that created the user, and is absent after a reload
    - Existing passing tests remain passing
  status: done — commit 1103778

- task: On the same /users screen — change a person's role between admin and
    staff; deactivate a person by deleting their `profiles` row (the frozen
    contract's definition of "no session"), guarded so that the last remaining
    admin cannot be deactivated and no admin can deactivate themselves; and a
    billing-person dropdown listing `tblbillingnames.initials` that sets
    `profiles.personid`. The dropdown is nullable and is legitimately empty until
    the migration lane has loaded `tblbillingnames`.
  guardrails:
    - Deleting a profiles row must never delete the `auth.users` row — deactivation is reversible by re-inserting
    - Both guards fail closed: the action is refused unless it can positively confirm another admin remains and that the target is not the actor
    - Never add a column or a migration; `supabase/migrations/**` is protected
  done when:
    - An admin attempting to deactivate their own account is refused with a visible message and their profiles row still exists
    - With exactly one admin remaining, deactivating that admin is refused; after a second person is promoted to admin, deactivating the first succeeds
    - Setting the billing-person dropdown writes `personid`, and `getSession()` returns it as `personId`; leaving it unset stores null
    - Deactivating a person and then re-creating their profiles row restores sign-in on the same auth account
  caution: true
  status: not started
  parallel-group: b

- task: `app/(auth)/account/page.tsx` — the signed-in user changes their own
    password. Current password, new password, confirm. Verifies the current
    password by re-authenticating with `signInWithPassword` before calling
    `updateUser`, so a temporary password handed over by an admin can be replaced
    privately.
  guardrails:
    - A user may change only their own password; the screen never accepts a target user id
    - Never log or echo either password
  done when:
    - The correct current password plus a new password succeeds, and the new password signs in on a fresh session while the old one is rejected
    - A wrong current password is refused with a visible error and the password is unchanged
    - Existing passing tests remain passing
  status: done — commit 973d8e9
  parallel-group: b

> **⚠️ AUTONOMOUS RUN — STOP HERE**
