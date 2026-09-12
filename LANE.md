# Technology Associates — Time Lane

## Objective

Each staff member logs their hours on a case in the app — typed in, or timed
with a start/stop button — and corrects them in a week view; every case shows
its unbilled hours the moment anyone opens it. This replaces the per-person
Excel workbooks on the NAS.

Lane done when:
- Journey 03 passes through its `/time` step on the merged branch, and the
  saved `tblactivity` row has `actwho` = that login's person, `actbilled=false`,
  `actbillid` null
- Starting the timer on case 90001, stopping it, and saving produces an entry
  whose hours equal the elapsed time rounded to the nearest 0.125 h (floor
  0.125); the week view shows it under today, and editing its description
  there persists
- `/cases/90001` shows a Time section listing the two fixture rows, with
  "Unbilled hours" = 2.000 (sum where `actbilled=false and actbillid is null`)
- Editing or removing a billed row from any time screen is refused and the row
  is unchanged

## Status

Branch `lane/time` off `integration` (`1d493ef`). Migration, app-shell, and
cases are merged. `/time` is already in the nav (`lib/auth/sections.ts`), and
journey 03 (`tests/journeys/03-time-to-bill.spec.ts`) fixes the `/time` form's
labels ("Case", "Hours", "Description"), button ("Add entry"), and success text
("Entry added"). Nothing under `app/time`, `lib/time`, or `tests/time` exists.

Lane: time — in-app time entry per person per case (replaces the NAS Excel timesheets); unbilled hours per case. Rate card deferred — bills are priced in the client's other service

Owned — this lane's items live inside these paths:
  app/time/**, lib/time/**, tests/time/**

Open — merged lanes. Wiring items may edit these; rebase onto `integration` first:
  migration: scripts/migrate/**, tests/migration/**
  app-shell: app/layout.tsx, app/page.tsx, app/globals.css, app/not-found.tsx, middleware.ts, app/(auth)/**, lib/auth/**, tests/app-shell/**
  cases: app/cases/**, app/firms/**, app/attorneys/**, app/clients/**, app/inquiries/**, lib/cases/**, lib/contacts/**, lib/inquiries/**, tests/cases/**

Stop and report if an item requires changing a path outside both lists:
  protected — supabase/migrations/**, lib/db/**, lib/auth/session.ts, lib/auth/client.ts, lib/env.ts, scripts/gen-db-types.mjs, tests/foundation/**, tests/journeys/**, playwright.config.ts, tsconfig.foundation.json
  an unmerged lane's — billing: app/bills/**, lib/bills/**, tests/billing/** · money: app/expenses/**, app/funds/**, app/bank-review/**, lib/expenses/**, lib/funds/**, lib/bank-import/**, tests/money/** · docs-reports: app/documents/**, app/reports/**, app/dashboard/**, lib/documents/**, lib/reports/**, lib/storage.ts, tests/docs-reports/**
  unowned — root config (package.json, pnpm-*.yaml, tsconfig, next/eslint/tailwind/postcss config, *.md), .github/workflows, .claude/worktrees, app/api/health, lib/health.ts, lib/ai.ts, lib/webhooks.ts, tests/*.test.mjs

Frozen contracts — build and test against these; they will not move:
  app-shell (session) — `lib/auth/session.ts`: `Session = { userId; email; role: 'admin'|'staff'; personId: number|null }`, `requireSession()`; login helper `tests/journeys/helpers.ts`
  cases (tblcase rows) — `lib/db/types.ts` `tblcase` Row; fixture `tests/foundation/fixtures/rows.ts` (case 90001)
  schema (tblactivity, tblbillingnames, profiles) — `lib/db/types.ts`; fixtures `tests/foundation/fixtures/rows.ts` (actid 1: KJS 2.000 unbilled; actid 2: JON 1.500 billed; personid 1 = KJS, 2 = JON)
  unbilled := `actbilled = false and actbillid is null` (migration 0002, check `tblactivity_billed_pair`)

Test against the fixture, not the producing lane. Do not wait for it to exist.

## Global rules

- Server-action pattern from `app/cases/[id]/actions.ts`: `"use server"`, `requireSession()`, a lib function taking `Db`, errors back through the query string, `revalidatePath`, `redirect(...)`. Pages are server components; only the timer and the header indicator are client components.
- Admin and staff are identical here except: admin may edit or delete any unbilled row and view any person's week (`?who=`). Staff act only on rows whose `actwho` equals their own `personId`.
- A login with `personId` null cannot enter, edit, or delete time. Show "Your login isn't linked to a person — an admin can set it on /users" in place of the form; refuse the POST server-side.
- Never write `actbilled` or `actbillid`. A row with `actbilled=true` or `actbillid` set is read-only on every screen in this lane, and the refusal lives in the write statement's filter, never only in a prior select.
- No migrations, no schema or type changes. Legacy lowercase table and column names. `acthrs` is `numeric(9,3)`: store hours as entered, 0 < hours ≤ 24, at most 3 decimals.
- Dates are firm-local (America/New_York): default via `firmToday()` from `lib/cases/presets.ts`; a week is Monday–Sunday in that zone; `actdate` is handled as a date-only string, no local-time `Date` arithmetic.
- Unit tests `tests/time/*.test.mjs` use the fake PostgREST proxy pattern from `tests/cases/create.test.mjs`. Browser checks `tests/time/*.live.test.mjs` follow `tests/cases/create.live.test.mjs`: skip cleanly without a dev server or `SUPABASE_SERVICE_ROLE_KEY`, invented case numbers 990000+, every inserted row removed in `after()` with the service role. A live test that needs a linked person sets `profiles.personid` on the E2E login with the service role in `before()` and restores the prior value in `after()`.
- Copy `.env.local` into each worktree before running live tests.
- At merge the Reviewer adds `tests/time/*.test.mjs` to the `test` script in `package.json` (unowned), as the cases merge did.
- Fuller context: `CLAUDE.md`, `MAP.md`, `LEGACY.md` (timesheets section), `CLIENT.md`.

## Not yet specified

- Whether the migrated `tblactivity` rows are real time or stale (LEGACY.md: tblActivity use unconfirmed; billing ran from Excel). Ask Kris. If stale, a one-shot go-live runbook step clears them — migration lane, not here — revisit after item 5 shows them on a real case
- Rounding for timed entries: nearest 0.125 h with a 0.125 floor is used here; confirm with Kris against the workbooks' eighth-hour convention (`tests/migration/load.test.mjs` shows 0.125 in legacy rows) — revisit after item 4

## Out of scope

- Importing the NAS Excel timesheet history into `tblactivity` — migration lane; MAP.md amended 2026-09-12; needs Kris's workbook samples
- Rates, `billingfactor` math, fees — deferred with billing output (MAP.md, 2026-09-08)
- Marking rows billed, assigning `actbillid` — billing lane
- Multi-row grid entry and inline cell editing — the edit page was chosen; polish after real use
- Server-side timer state — needs a schema amendment; a browser-local timer covers one machine per person
- Hours-by-person or by-period reports — docs-reports lane

---

- task: Time entry form and insert. `app/time/page.tsx` (server component) renders
    `app/time/entry-form.tsx` with fields labelled exactly "Case" (typed case
    number; `?case=` pre-fills it), "Date" (`<input type="date">`, default
    `firmToday(new Date())`), "Hours" (`<input type="number" step="0.125"
    min="0.125" max="24">`, up to 3 decimals accepted), "Description"; submit
    button "Add entry". Server action `addEntry` in `app/time/actions.ts` calls
    `insertEntry(db, session, input)` in `lib/time/entries.ts`: validates that the
    case exists (one select on `tblcase.caseid`), hours parse to 0 < h ≤ 24 with at
    most 3 decimals, description non-empty; inserts `tblactivity`
    `{ actcaseid, actdate, actdescription, acthrs, actwho: session.personId }` and
    redirects to `/time?added=1`, where the page shows "Entry added". Errors come
    back through `?error=<code>` and render inline above the form with the typed
    values kept. A session with `personId` null gets the not-linked message in
    place of the form.
  guardrails:
    - `actwho` comes from the session, never from a form field
    - Hours are stored as entered; the server never rounds
    - Exactly one control labelled "Case" and one labelled "Hours" on `/time` (journey 03 uses `getByLabel`)
  done when:
    - A linked staff login submitting case 90001, hours 1.5, "Reviewed file" sees "Entry added", and a `tblactivity` row exists with that login's `personId` as `actwho`, `actbilled=false`, `actbillid` null (live test; row removed in `after()`)
    - Case 999999, hours 0, hours 25, hours 1.0625, and an empty description are each refused with a visible message and insert nothing (fake-client tests; the case check is a select on `tblcase`)
    - A login with `personId` null sees the not-linked message and no form, and a direct call of the action from it inserts nothing
  status: done

- task: Week view on `/time` under the form, plus the admin unbilled-by-case
    section. `lib/time/week.ts`: `weekBounds(anchor)` returns the Monday and
    Sunday date strings of the week containing `anchor` (America/New_York;
    `?week=YYYY-MM-DD` may be any day of the week; default this week);
    `listWeek(db, personId, monday)` returns that person's rows joined to
    `tblcase` (`caseid`, `casetitle`), ordered by date then `actid`. The page
    groups rows by day with a per-day subtotal and a week total, "Previous week" /
    "Next week" links (±7 days), and per row: date (linking to `/time/<actid>`),
    case # + title, description, hours to 3 decimals, and a "billed" marker when
    `actbilled` or `actbillid` is set. Admin only: a "Person" select of
    `tblbillingnames` initials driving `?who=<personid>`, and above the week an
    "Unbilled hours by case" table from `unbilledByCase(db)` in
    `lib/time/unbilled.ts` (case #, title, sum of unbilled `acthrs`; cases at 0
    omitted; ordered by case #; each row linking to `/cases/<id>`).
  guardrails:
    - Week bounds are computed on date strings in America/New_York; no local-time `Date` arithmetic that shifts with the server's TZ
    - Staff see only rows where `actwho` equals their own `personId`; `?who=` is ignored for staff
    - Read-only: this item writes nothing
  done when:
    - With fake rows for person 1 across two weeks, the week containing 2026-01-15 shows only that person's rows in that Mon–Sun span, grouped by day, with day subtotals and the week total equal to a hand sum; `?week=` on a Sunday and on the following Monday yield different weeks; prev/next links move exactly 7 days
    - `weekBounds` returns the same Monday under `TZ=UTC` and `TZ=America/New_York` for the same anchor
    - Admin `?who=2` shows JON's fixture row; staff `?who=2` still shows only their own rows; the admin unbilled-by-case table lists case 90001 at 2.000 and omits a case whose rows are all billed
    - Existing passing tests remain passing
  status: done
  parallel-group: a

- task: Edit and delete at `/time/[id]`. `app/time/[id]/page.tsx` loads the row.
    Unbilled and (own, or admin): reuse `app/time/entry-form.tsx` pre-filled, with
    a "Save" button and a separate "Delete" button (a plain form POST, no browser
    confirm dialog). Billed: the same fields rendered read-only with "Billed on
    bill <actbillid>" (or "Billed" when only `actbilled` is set) and no buttons.
    Another person's row for staff: "Not found". Actions `updateEntry` /
    `deleteEntry` in `app/time/actions.ts` call `updateEntry(db, session, actid,
    input)` / `deleteEntry(db, session, actid)` in `lib/time/entries.ts`: same
    validation as insert; the UPDATE/DELETE statement itself filters
    `actid = ? and actbilled = false and actbillid is null`, plus `actwho =
    personId` unless admin; zero rows affected → "This entry can't be changed"
    and nothing written. Update writes only changed columns (diff as
    `lib/cases/record.ts` does). Success redirects to
    `/time?week=<that row's date>&saved=1` ("Entry saved") or `&deleted=1`
    ("Entry deleted").
  guardrails:
    - Ownership and unbilled checks live in the write statement's filter (`.eq("actbilled", false).is("actbillid", null)`, and `.eq("actwho", personId)` for staff), never only in a prior select
    - An edit never changes `actwho`; `actbilled` and `actbillid` are never written
    - No browser confirm dialog on Delete
  done when:
    - Editing an own unbilled row's hours and description persists and the week view shows the new values; a fake-client test asserts the update and delete chains carry the `actbilled=false` and `actbillid is null` filters
    - Editing or deleting fixture row 2 (billed) is refused: the page shows it read-only with no Save or Delete, and a direct call of either action reports "This entry can't be changed" with the row unchanged
    - A staff call of `updateEntry` or `deleteEntry` against another person's unbilled row is refused and the row is unchanged; the same call as admin succeeds
    - Deleting an own unbilled row removes it from `tblactivity` and shows "Entry deleted"
  status: done
  parallel-group: a

- task: Start/stop timer on `/time`. Client component `app/time/timer.tsx`
    rendered above the entry form. "Start timer" reads the form's Case field
    (refuses with "Enter a case number first" when empty), stores
    `{ caseId, startedAt, description }` under one `localStorage` key
    (`ta.timer`), and shows a ticking elapsed `h:mm:ss` with a "Stop" button and a
    description text input for the draft. One timer at a time: while the key
    exists, Start is refused with "Stop the running timer first". Stop computes
    hours = max(0.125, round(elapsed_hours / 0.125) × 0.125), fills the form's
    Hours, Date (`firmToday`), Case, and Description, and shows "Discard".
    Submitting the form (item 1's action) clears the key on the `?added=1` render;
    Discard clears it without inserting. The clock is injectable (`now` prop,
    default `Date.now`) so rounding and ticking are unit-testable; a reload
    mid-run reads the key and keeps ticking from the stored `startedAt`.
    `?case=<id>` (from the case page) pre-fills the form's Case field, so Start
    works immediately.
  guardrails:
    - Timer state never reaches the database until the entry form is submitted
    - Rounding happens only on Stop, client-side; the server stores what the form sends
    - No second control labelled "Case" or "Hours"; the timer reuses the form's fields
  done when:
    - With an injected clock, Stop fills Hours with 0.125 after 3 s, 0.125 after 7 min, 0.625 after 40 min, and 2.125 after 2 h 4 min
    - Reloading `/time` mid-run shows the timer still running from the stored start and Start is refused; after Stop then Add entry the row exists with the rounded hours and the key is gone; Discard clears the key and inserts nothing
    - Visiting `/time?case=90001` pre-fills Case with 90001 and Start begins a timer for that case
  status: done

- task: Time panel on the case page (wiring, cases). `app/cases/[id]/time-panel.tsx`
    (server component) with `listCaseTime(db, caseId)` and `unbilledHours(rows)`
    in `lib/time/case.ts`. Rendered in the slot grid of `app/cases/[id]/page.tsx`
    as a fourth panel headed "Time" beside Bills / Funds received / Expenses:
    rows newest first (date, initials from `tblbillingnames`, hours to 3
    decimals, description, a "billed" marker when `actbilled` or `actbillid` is
    set), a line "Unbilled hours: N.NNN" summing rows where `actbilled=false and
    actbillid is null`, and links "Add entry" and "Start timer", both to
    `/time?case=<caseid>`. Empty case: "No time entries" and a total of 0.000.
  guardrails:
    - Adds a panel only; the case form, the service-auths panel, and the three placeholder slots are unchanged
    - Reads only; no action is added to the case page
    - Do not add a second element matching `/bills/i` (journey 01's known ambiguity)
  done when:
    - `/cases/90001` shows a "Time" panel with "KJS 2.000 Site inspection" (no billed marker), "JON 1.500 Photo review" (billed), and "Unbilled hours: 2.000" (fake-client test on the panel's data, plus a live check)
    - "Add entry" on the panel opens `/time?case=90001` with Case pre-filled, and an entry added there appears at the top of the panel and raises the unbilled total by its hours
    - Journey 02 stays green, journey 01 still fails only at its known `/bills/i` ambiguity, and `tests/cases/*.test.mjs` remain passing
  after: cases
  status: not started

- task: Running-timer indicator in the header, and the E2E staff seed (wiring,
    app-shell). `app/time/running-indicator.tsx` (client component) reads the
    `ta.timer` localStorage key in an effect, renders nothing when it is absent,
    else a link to `/time` reading "⏱ Case <caseId> · h:mm" that updates each
    minute; imported into `Header` in `app/layout.tsx` next to the account link.
    `tests/app-shell/seed-e2e.ts`: the staff profile upsert sets `personid: 1`
    (KJS) so journey 03's staff login is a linked person.
  guardrails:
    - `app/layout.tsx` session handling, nav sections, and fail-closed behaviour are unchanged; the indicator is an additional child only
    - The indicator reads no server data and renders nothing on the server pass (no hydration mismatch)
    - The seed change touches only the staff profile's `personid`
  done when:
    - With a timer running, `/cases/90001` and `/` both show "Case 90001" with the elapsed time in the header, linking to `/time`; with no timer the header is unchanged (live test)
    - After `tests/app-shell/seed-e2e.ts` runs, the staff E2E profile has `personid = 1`, and journey 03 passes its `/time` steps through "Entry added" (its later `/bills` steps still fail; they belong to billing)
    - `tests/app-shell/*.test.mjs` remain passing
  after: app-shell
  status: not started

> **⚠️ AUTONOMOUS RUN — STOP HERE**
