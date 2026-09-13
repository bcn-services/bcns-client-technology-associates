# Technology Associates — Billing Lane

## Objective

Kris records every bill in the app instead of Access: each bill sits on a case
with a type, pulls its hours from the case's unbilled time, takes its balance
from the billing service, and moves through 1st → 2nd → Final notice while
unpaid — so every case shows what has been billed and what is still owed.

Lane done when:
- Journey 03 passes end to end on the merged branch (after the `/billed/i`
  amendment below)
- Creating a timesheet bill on case 90001 takes the case page's "Unbilled
  hours" to 0.000, and every `tblactivity` row pulled in carries that bill's
  `billid` with `actbilled=true`
- The case page lists every bill on the case, legacy bills included, with its
  notice status; `data-testid="unpaid-bill-count"` is computed live from the
  bills, never read from `tblcase.numunpaidbills`
- Advancing an open bill 1st → 2nd → Final stamps each notice's date, and
  `/bills` lists open bills grouped by notice stage

## Status

Branch `lane/billing` off `integration` (`59c6cd4`). Migration, app-shell,
cases, and time are merged. `/bills` is already in the nav
(`lib/auth/sections.ts`); the case page holds a `<Slot title="Bills" />`
placeholder (`app/cases/[id]/page.tsx:194`). Journey 03
(`tests/journeys/03-time-to-bill.spec.ts`) fixes `/bills/new?case=<id>`: text
"Unbilled hours", a "Balance" field, a "Create bill" button. Nothing under
`app/bills`, `lib/bills`, or `tests/billing` exists.

Lane: billing — bill records tagged with one of 6 types, hours pulled from unbilled activity rows (merged multi-person), balance entered from the client's billing service, notice sequence dates, threshold alert, revisions as versions — no PDF, no email, no rate math

Owned — this lane's items live inside these paths:
  app/bills/**, lib/bills/**, tests/billing/**

Open — merged lanes. Wiring items may edit these; rebase onto `integration` first:
  migration: scripts/migrate/**, tests/migration/**
  app-shell: app/layout.tsx, app/page.tsx, app/globals.css, app/not-found.tsx, middleware.ts, app/(auth)/**, lib/auth/**, tests/app-shell/**
  cases: app/cases/**, app/firms/**, app/attorneys/**, app/clients/**, app/inquiries/**, lib/cases/**, lib/contacts/**, lib/inquiries/**, tests/cases/**
  time: app/time/**, lib/time/**, tests/time/**

Stop and report if an item requires changing a path outside both lists:
  protected — supabase/migrations/**, lib/db/**, lib/auth/session.ts, lib/auth/client.ts, lib/env.ts, scripts/gen-db-types.mjs, tests/foundation/**, tests/journeys/**, playwright.config.ts, tsconfig.foundation.json
  an unmerged lane's — money: app/expenses/**, app/funds/**, app/bank-review/**, lib/expenses/**, lib/funds/**, lib/bank-import/**, tests/money/** · docs-reports: app/documents/**, app/reports/**, app/dashboard/**, lib/documents/**, lib/reports/**, lib/storage.ts, tests/docs-reports/**
  unowned — root config (package.json, pnpm-*.yaml, tsconfig, next/eslint/tailwind/postcss config, *.md), .github/workflows, .claude/worktrees, app/api/health, lib/health.ts, lib/ai.ts, lib/webhooks.ts, tests/*.test.mjs

Frozen contracts — build and test against these; they will not move:
  app-shell (session) — `lib/auth/session.ts`: `Session = { userId; email; role: 'admin'|'staff'; personId: number|null }`, `requireSession('admin')` throws `ForbiddenError` for staff; login helper `tests/journeys/helpers.ts`
  time (unbilled tblactivity rows) — `lib/db/types.ts` `tblactivity` Row; fixture `tests/foundation/fixtures/rows.ts` (actid 1: KJS 2.000 unbilled; actid 2: JON 1.500 billed, no billid); unbilled := `actbilled = false and actbillid is null`; check `actbillid is null or actbilled` (migration 0002)
  cases (tblcase rows) — `lib/db/types.ts` `tblcase` Row (`caseatty` → `tblattorney.attylastname`, `billingalert`, `billingcc`); fixture case 90001
  schema (tblbills) — `lib/db/types.ts` `tblbills` Row incl. `billtype` (check: blank, timesheet, depoprep, depo, trial, retainer) and `supersedesbillid`; fixture billid 1 on 90001

Test against the fixture, not the producing lane. Do not wait for it to exist.

## Global rules

- Server-action pattern from `app/time/actions.ts`: `"use server"`, `requireSession(...)`, parse FormData, a `lib/bills` function taking `Db` that throws a typed error with `.code`, errors back via `?error=<code>`, `revalidatePath` + `redirect` on success. Pages are server components.
- Every write action calls `requireSession('admin')`. Staff read every billing screen and change nothing; admin-only controls are not rendered for staff.
- `billnotice` strings use the legacy spelling exactly: `1st`, `2nd`, `Final`, `Partial Payment`, `Deadbeat`, `Paid`, `Carried Over`, `Cancelled`, `Refund`, `Credit`, `Settled`. "Open" (unpaid) = {1st, 2nd, Final, Partial Payment, Deadbeat}, defined once in `lib/bills/rules.ts` and imported everywhere.
- Never write `tblcase.numunpaidbills`, `billpaiddate`, or a `Paid` / `Partial Payment` status — money lane. Never hard-delete a bill except the rollback of a bill inserted in the same request.
- No transactions over PostgREST: a multi-row write guards its `update` with the expected current values in the filter, checks the returned row count, and compensates on mismatch. The guard lives in the write statement, never only in a prior select.
- Legacy bills (`billtype` null, `billhours` 0, any legacy status) render on every screen without error.
- No migrations, no schema or type changes. No PDF, email, or rate math.
- Dates are firm-local (America/New_York) via `firmToday()` from `lib/cases/presets.ts`; bill dates are date-only strings, no local-time `Date` arithmetic.
- Unit tests `tests/billing/*.test.mjs` use the fake PostgREST proxy pattern from `tests/cases/create.test.mjs`. Browser checks `tests/billing/*.live.test.mjs` follow `tests/time/*.live.test.mjs`: skip cleanly without a dev server or `SUPABASE_SERVICE_ROLE_KEY`, invented case numbers 990000+, every inserted row removed in `after()` with the service role. Fixtures use invented data only.
- Existing passing tests remain passing, including the cases and time suites.
- Copy `.env.local` into each worktree before running live tests.
- At merge the Reviewer adds `tests/billing/*.test.mjs` to the `test` script in `package.json` (unowned), as the time merge did.
- Fuller context: `CLAUDE.md`, `MAP.md`, `LEGACY.md` (tblBills section), `CLIENT.md`.

## Not yet specified

- Whether Kris wants notice-due reminders beyond the `/bills` due badge (email, dashboard) — revisit after item 6 is in his hands; the dashboard is docs-reports' lane

## Out of scope

- Bill PDF rendering and email delivery, including sending to `billingcc` — deferred add-on; client bills from another service (MAP.md)
- Rate card and rate math — deferred with billing output; balance is typed in
- Marking bills Paid / Partial Payment and setting `billpaiddate` — money lane (funds received against bills)
- Writing `tblcase.numunpaidbills` — legacy denormalized counter; the app computes unpaid counts live
- UI for `billreports` and `billpriority` — unused in the workflow Kris described; columns stay as loaded
- Backfilling `actbillid` on legacy billed rows — FOUNDATION.md rules it out; legacy rows keep `actbilled=true`, `actbillid` null

---

- task: Bill rules — `lib/bills/rules.ts`, pure functions every billing screen
    imports. Exports the open-status set and `isOpen(notice)`; `nextNotice(notice)`
    (1st → 2nd → Final → null; anything else → null); the close-as set
    {Cancelled, Carried Over, Deadbeat, Settled}; the start-status set {1st,
    Credit, Refund}; `billFileName(caseId, attyLastName, billdate, n)` →
    `Bill<caseid> <last name> <yyyy mm dd>-<n>`; `lastNoticeDate(bill)` =
    `billfinalnoticedate ?? billsecondnoticedate ?? billdate`;
    `daysSinceNotice(bill, today)`; `isDue(bill, today)` = open and
    `daysSinceNotice ≥ BILL_DUE_DAYS` (30).
  guardrails:
    - No DB access and no clock reads — `today` is always a parameter
    - Date math on `yyyy-mm-dd` strings only; never a local-time `Date`
  done when:
    - `isOpen` is true for exactly 1st, 2nd, Final, Partial Payment, Deadbeat, and false for Paid, Cancelled, Carried Over, Credit, Refund, Settled, and `First`
    - `nextNotice` maps '1st'→'2nd', '2nd'→'Final', 'Final'→null, 'Paid'→null
    - `billFileName(2788, 'Flood', '2026-08-14', 1)` returns `Bill2788 Flood 2026 08 14-1`
    - `isDue`: a 1st bill dated 30 days before `today` is due, 29 days is not; a Final bill counts from `billfinalnoticedate`; results identical under `TZ=UTC` and `TZ=America/New_York`
  status: done

- task: Bill page with edit-in-place — `app/bills/[id]/page.tsx` shows every
    `tblbills` field for bill N, its case (linked to `/cases/<id>`), the
    `tblactivity` rows with `actbillid = N` (date, who, description, hours), and
    revision links ("Revises #M" when `supersedesbillid` is set; "Revised by #K"
    when another bill supersedes it). Admins get an edit form for `billdate`,
    `billtype`, `billbalance` (negative allowed), `billestimate`,
    `billcomments`, `billfilename`; the action lives in `app/bills/actions.ts`,
    the write in `lib/bills/`. Unknown id → `notFound()`.
  guardrails:
    - The edit never writes `billnotice`, `billsecondnoticedate`, `billfinalnoticedate`, `billpaiddate`, `billhours`, `billcaseid`, or any `tblactivity` row
    - History comes from the existing `audit_log` trigger; no history table or column of this lane's own
  done when:
    - A legacy-style bill (`billtype` null, `billhours` 0, `billnotice` 'Paid') renders its balance, status, and an em-dash for type
    - An admin changes balance 875.00 → 900.00 and comments; after reload both show the new values, and `billnotice` and `billhours` are unchanged in the row
    - A staff login sees no edit form; the edit action posted as staff is refused and the row is unchanged
    - A bill with two attached activity rows lists both with their hours
  status: done
  ui: true

- task: Create bill — `/bills/new?case=<id>` (`app/bills/new/page.tsx`,
    create action in `app/bills/actions.ts`, write in `lib/bills/create.ts`).
    One form: `billtype` select (6 types); the case's unbilled `tblactivity`
    rows as checkboxes (all checked when type is timesheet, none otherwise) with
    an "Unbilled hours" total; Bill date (default `firmToday()`); "Balance"
    (negative allowed); start status (1st default, Credit, Refund); estimate;
    comments; button "Create bill". Save: insert the bill with `billhours` = sum
    of checked rows' `acthrs` and `billfilename` = `billFileName(case, attorney
    last name, billdate, n)` where n = count of that case's bills already dated
    that day; then `update tblactivity set actbilled=true, actbillid=<new> where
    actid in (<checked>) and actbilled=false and actbillid is null`. Returned
    count ≠ checked count → revert rows now pointing at the new bill, delete it,
    redirect `?error=stale` ("Some entries were billed meanwhile — reload and
    try again"). Success → redirect `/bills/<new id>`.
  guardrails:
    - Only the checked rows are ever updated; a row already billed is never re-pointed to another bill
    - A failed save leaves no new bill and no changed `tblactivity` row
    - Hours are never typed — `billhours` always equals the checked rows' sum
  done when:
    - Timesheet bill on a case with unbilled rows of 1.500 h and 0.500 h, balance 450.00: the bill has `billhours` 2.000, `billnotice` '1st', `billfilename` `Bill<case> <atty last> <yyyy mm dd>-0`; both rows are `actbilled=true, actbillid=<new>`, and the case's unbilled hours read 0.000
    - A retainer bill saved with nothing checked has `billhours` 0 and changes no `tblactivity` row
    - Reliability: when one checked row is billed elsewhere after the form loads, the save redirects with `error=stale`, no new bill row exists, and the other checked row is still unbilled
    - The create action posted as staff is refused and no `tblbills` row is inserted
  status: not started
  ui: true

- task: Notice actions on `/bills/[id]` — **Advance** (1st → 2nd stamps
    `billsecondnoticedate`; 2nd → Final stamps `billfinalnoticedate`; date =
    `firmToday()`) and **Close as** (Cancelled / Carried Over / Deadbeat /
    Settled). Each update filters on the bill's expected current `billnotice`,
    so a stale or duplicate submit changes nothing and returns `?error=stale`.
    Buttons render only for admins and only when the move is allowed by
    `lib/bills/rules.ts`.
  guardrails:
    - Never writes `billpaiddate`, 'Paid', or 'Partial Payment'
    - Never overwrites an already-stamped notice date
    - A closed bill (not open) is never changed by either action
  done when:
    - Advancing a 1st bill sets '2nd' and `billsecondnoticedate` = today; advancing again sets 'Final' and `billfinalnoticedate` = today with the second-notice date unchanged; a Final bill shows no Advance button
    - Close as Cancelled on a 2nd bill sets 'Cancelled' and leaves both notice dates unchanged; both actions are refused on a Paid bill and the row is unchanged
    - Reliability: two concurrent Advance submits on the same 1st bill leave it at '2nd', not 'Final'
    - Reliability: an Advance at 23:30 America/New_York with the server on `TZ=UTC` stamps the New York date
  status: not started
  ui: true

- task: Revise — a "Revise" button on `/bills/[id]` for an open bill that no
    other bill supersedes (`lib/bills/revise.ts`). Creates B′ with
    `supersedesbillid = B`, copying `billcaseid`, `billtype`, `billhours`,
    `billbalance`, `billestimate`, `billcomments`; `billdate` = today,
    `billnotice` '1st', new `billfilename`. Then moves B's activity rows (guarded
    `where actbillid = B`), then sets B to 'Cancelled' (guarded on B's current
    status). Any step failing → move rows back to B, delete B′, `?error=stale`.
    Success → redirect `/bills/<B′>`.
  guardrails:
    - B is never deleted, and no field of B other than `billnotice` changes
    - Rows move only from B to B′ — no other bill's rows are touched
  done when:
    - Revising open bill B with two attached rows creates B′ with B's type, hours, and balance and status '1st'; both rows now have `actbillid = B′`; B is 'Cancelled' with every other field unchanged
    - B's page shows "Revised by #B′" linking to B′, and B′'s page shows "Revises #B"
    - Revising B a second time is refused and inserts no bill
    - The case's unbilled hours are the same before and after the revise
  status: not started
  ui: true

- task: `/bills` list — `app/bills/page.tsx`, readable by staff. Open bills
    only, grouped by stage in order 1st, 2nd, Final, Partial Payment, Deadbeat.
    Each row: case number (linked to the case), filename (linked to the bill),
    bill date, balance, "N days" since `lastNoticeDate`, and a **due** badge
    when `isDue`. Within a group, most days first. One query filtered to open
    statuses, joined to `tblcase` for the case number — no per-row fetch.
  guardrails:
    - Read-only page — no write action on it
  done when:
    - With seeded bills in 1st, 2nd, Final, Paid, and Cancelled, exactly the three open ones show, under their stage headings in order
    - A 1st bill 45 days old shows "45 days" and a due badge and sorts above a 10-day-old 1st bill with no badge
    - A staff login can open `/bills` and sees the list
    - Median of 5 renders of `/bills` stays under 1 s with 5,000 bills seeded, 100 of them open
  status: not started

- task: Recipient alert — when the bill's case has `tblcase.billingalert`
    true, `/bills/new` and `/bills/[id]` show a banner "Bill recipient alert —
    this case bills a different party". Whenever `billingcc` is non-empty, a
    "CC: <billingcc>" line shows (with or without the alert). Shared component
    in `app/bills/`.
  guardrails:
    - Display only — never blocks or changes a save
    - Never writes `billingalert` or `billingcc` (cases lane owns them)
  done when:
    - A case with `billingalert` true and `billingcc` 'a@x.test, b@x.test' shows the banner and both addresses on `/bills/new?case=<id>` and on that case's bill page
    - A case with `billingalert` false shows no banner; with a non-empty `billingcc` it still shows the CC line
  status: not started

- task: Wire bills into the case page — replace `<Slot title="Bills" />` at
    `app/cases/[id]/page.tsx:194` with a billing-owned `BillsPanel`
    (`app/bills/bills-panel.tsx`, data from `lib/bills/`). It lists every bill
    on the case newest first — date, type, balance, `billnotice`, linked to
    `/bills/<id>` — plus `data-testid="unpaid-bill-count"` (count of open
    bills, live), and the latest open bill's `billsecondnoticedate` /
    `billfinalnoticedate` under `data-testid="second-notice-date"` /
    `"final-notice-date"` (empty when unset or none open). Admins see a "New
    bill" link to `/bills/new?case=<id>`.
  guardrails:
    - In `app/cases/[id]/page.tsx` only the Slot line and one import change
    - Panel copy never contains the word "billed" — journey 03 matches `/billed/i` on this page
    - The panel's heading keeps "Bills" (journey 01 expects it)
  done when:
    - The case page now renders `BillsPanel`; a case with three bills (one legacy: `billtype` null, `billhours` 0, 'Paid') lists all three newest first, each with balance, status, and a link to its bill page
    - With bills in 1st, Deadbeat, and Paid and `tblcase.numunpaidbills` = 5, `unpaid-bill-count` shows 2
    - After creating a bill through `/bills/new`, the case page shows its balance — journey 03 passes through its `450.00` assertion
    - A staff login sees the panel without the "New bill" link
  status: not started
  ui: true
  after: cases

- task: Wire bills into time screens — where a `tblactivity` row has
    `actbillid = N`, the case Time panel (`app/cases/[id]/time-panel.tsx`) and
    the `/time` week view (`app/time/week-view.tsx`) keep the existing billed
    marker and add a link "Bill #N" to `/bills/N`. Legacy billed rows
    (`actbillid` null) keep the marker with no link.
  guardrails:
    - Link text never matches `/bills/i` (journey 01 trap noted in `time-panel.tsx:7`)
    - `data-testid="billed-marker"` and time's edit/delete rules are unchanged
  done when:
    - On the case page, a row with `actbillid = N` shows "Bill #N" linking to `/bills/N`; a legacy billed row shows its billed marker and no link; an unbilled row shows neither
    - In the `/time` week view, the logged-in person's row with `actbillid = N` shows the same "Bill #N" link
  status: not started
  after: time

> **⚠️ AUTONOMOUS RUN — STOP HERE**
