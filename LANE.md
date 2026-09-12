# Technology Associates — Lane: cases

## Objective

Staff can find any case (migrated or new), open its full record (firm,
attorney, client, status, priority, service authorizations) and edit it, and
turn a logged inquiry into a case — replacing the Access case and inquiry forms.

Lane done when:
- Journey 02 passes on the merged branch
- A migrated fixture case opens at `/cases/<id>` with the same values as its
  `tblcase` row, and search finds it by case number, title, and client name
- Editing a case as staff persists; no delete path exists anywhere in the lane

Status: nothing built. `integration` carries migration + app-shell (merged
2026-09-10, `464ab58`). Journey 01 stays red after this lane — its Bills /
Funds / Expenses content belongs to billing and money; this lane renders the
empty slots.

Preconditions — both amendments land on `main`, merge to `integration`, and this
branch rebases onto them before `/dev-team-auto` runs:
- `supabase/migrations/0007_case_search_view.sql` — view `case_search` with
  columns caseid, casetitle, casenotes, casecaption, attyname, attyemail,
  attyphone, frmname, frmphone, clientname, otherexperts. `tblcase` LEFT JOINs
  attorney, firm, and client (FKs are NOT VALID; an inner join silently drops
  orphan cases). attyname = first + ' ' + middle + ' ' + last, clientname =
  first + ' ' + last, nulls as ''. Regenerate `lib/db/types.ts`.
- `tests/journeys/02-inquiry-to-case.spec.ts` — before clicking "convert to
  case", select the fixture attorney (Pat Example) and client (Sam Sample) by
  id value `1` in pickers labelled exactly "Case attorney" and "Case client"
  (the inquiry form already has "AttyName" and "Client" fields).

Both landed on `main` in `c27d712` and were merged into `integration` (`c671c55`).

Merge-time step (unowned root config): add `tests/cases/*.test.mjs` to the
`test` script in `package.json`, as app-shell did.

Lane: cases — cases, firms, attorneys, clients, inquiries, service authorizations, case search

Owned — this lane's items live inside these paths:
  app/cases/**, app/firms/**, app/attorneys/**, app/clients/**,
  app/inquiries/**, lib/cases/**, lib/contacts/**, lib/inquiries/**,
  tests/cases/**

Open — merged lanes. Wiring items may edit these; rebase onto `integration` first:
  migration — scripts/migrate/**, tests/migration/**
  app-shell — app/layout.tsx, app/page.tsx, app/globals.css,
    app/not-found.tsx, middleware.ts, app/(auth)/**, lib/auth/**,
    tests/app-shell/**

Stop and report if an item requires changing a path outside both lists:
  protected — supabase/migrations/**, lib/db/**, lib/auth/session.ts,
    lib/auth/client.ts, lib/env.ts, scripts/gen-db-types.mjs,
    tests/foundation/**, tests/journeys/**, playwright.config.ts,
    tsconfig.foundation.json
  an unmerged lane's — app/time/**, lib/time/**, tests/time/**,
    app/bills/**, lib/bills/**, tests/billing/**, app/expenses/**,
    app/funds/**, app/bank-review/**, lib/expenses/**, lib/funds/**,
    lib/bank-import/**, tests/money/**, app/documents/**, app/reports/**,
    app/dashboard/**, lib/documents/**, lib/reports/**, lib/storage.ts,
    tests/docs-reports/**
  unowned — repo root config (package.json, pnpm-*.yaml, tsconfig,
    next/eslint/tailwind/postcss config, *.md), .github/workflows,
    .claude/worktrees, app/api/health, lib/health.ts, lib/ai.ts,
    lib/webhooks.ts, tests/*.test.mjs

Frozen contracts — build and test against these; they will not move:
  app-shell → `lib/auth/session.ts` (`requireSession`, `Session`, `Role`),
    fixture `tests/journeys/helpers.ts` (`login`, `CASE_ID`)
  schema → `lib/db/types.ts`, fixture `tests/foundation/fixtures/rows.ts`

Test against the fixture, not the producing lane. Do not wait for it to exist.

## Global rules

- Every page follows `app/(auth)/users/page.tsx`: `export const dynamic =
  "force-dynamic"`, `requireSession()` first, then `createServerClient()` from
  `lib/db/client.ts`, parallel reads with `Promise.all`, Tailwind.
- Admin and staff have identical access to every screen in this lane.
- No hard delete for anyone — no delete button, action, or query on any case,
  firm, attorney, client, inquiry, or service-authorization row.
- Legacy table and column names are used as migrated (lowercase). Never add a
  column or migration; `supabase/migrations/**` is protected.
- Screens match the legacy Access forms' fields, labels, and value lists
  (catalog: `LEGACY.md`). Dropdowns backed by a lookup table (`tblcasestatus`,
  `tblcasepriority`, `tblcasewaitingfor`, `tblbranches`, `tblstates`) read it
  live — never hard-code those values.
- Legacy text comparisons were case-insensitive (Access); every status or
  value-list comparison ported here is case-insensitive too.
- An update writes only the columns the user changed — a save never writes
  back a column the form did not show.
- `numunpaidbills` and `numunapprovedsa` are never written; both counts are
  computed live when shown.
- Unit tests: `tests/cases/*.test.mjs` with fake clients via `tsx --test`;
  live tests `tests/cases/*.live.test.mjs` against local Supabase. Fixtures and
  seeds use invented data only.
- Copy `.env.local` into the worktree before running any item.
- Context: `CLAUDE.md`, `CLIENT.md`, `LEGACY.md`, `FOUNDATION.md`, `MAP.md`.

## Not yet specified

- `CaseStatDueDateDescription` value list (Inspection, Telecom, Meeting, IUO
  Depo, KJS Depo, LLB Depo, Trial) was found beside the field, not bound to it —
  confirm with Kris after item 4 ships; free text with suggestions until then.

## Out of scope

- `AwaitingRetainer` / `AwaitingMaterial` — not in the migrated schema; ask Kris
  whether they still matter (a schema amendment if so).
- Bills, funds received, expenses, activity, income on the case page — billing
  and money lanes; this lane leaves empty slots.
- Financial presets (bill payments, income, expense, checkbook, crosstabs,
  unbilled-case queries) — billing, money, docs-reports.
- CasesPerYear / InquiriesPerYear — reports (docs-reports); their SQL is not
  recoverable from the Access file.
- Scanned documents, NAS / front-desk folder links, report/memo/summary
  generators, email-attorney button — docs-reports.
- Paying bills or touching a bank account — the office manager's job, handled
  by separate scripts; the app never moves money.
- Hard deletes, including legacy `qryDeleteAttys` / `qryDeleteFirms` — ruled out.
- Automated duplicate-attorney detection — legacy is a sorted worksheet a human
  scans; fuzzy matching would not be faithful.

---

- task: Firms, attorneys, and clients — list, create, and edit screens at
    `/firms`, `/attorneys`, `/clients`, logic in `lib/contacts/**`. Fields per the
    legacy forms. Firm: name, address 1/2, city, state (from `tblstates`), zip,
    phone, fax, email, practice type (Plaintiff / "Defendent" [legacy spelling,
    kept] / NA), size (Small/Medium/Large), active (text, as stored). Attorney:
    first, middle, last, suffix, Esq. checkbox, title, firm picker, phone, email,
    cell. Client: title, first, last, phone, notes. Legacy presets as named
    views: active firms (by `frmactive` value), attorney list by last name with
    firm and address (duplicate worksheet), firm list by name (rename list),
    attorneys with their cases ordered by attorney (attorney-ID fix list), cases
    by firm state.
  guardrails:
    - No delete path for any contact row
    - `frmactive` is text — filter by its stored values, never cast to boolean
  done when:
    - Creating then editing a firm, an attorney (attached to that firm), and a client persists every legacy field, re-read from the database
    - Each of the five presets returns the rows its legacy query returns against a seeded set, in the legacy sort order
    - The fixture attorney Pat Example opens showing firm "Example & Partners LLP"
    - Existing passing tests remain passing
  status: done
  parallel-group: a

- task: Inquiries — `/inquiries` list, `/inquiries/new`, `/inquiries/[id]` edit,
    logic in `lib/inquiries/**`. Fields per the legacy Add/Edit Inquiry form:
    date, time, caller name, caller title (Attorney, Paralegal, Secretary,
    Insurance Claims Rep, Investigator), attorney name if not caller (free
    text), attorney picker (`inqattyid`, optional), firm, firm location, caller
    location, accident location, description, phone, alt phone, fax, email,
    caption, subject, branch, referred by, how heard (legacy 14-value list,
    default "Unknown"), previous case, receptionist, client role (Plaintiff,
    Defendant, Third Party, Unknown, Other), engineer (legacy 5-value list,
    default "Dr. Ojalvo"), resulting case (read-only), and the "sent" panel
    (fee schedule, checklist, LLB, KJS, IUO, IUO-Biomech, Oren, Larry,
    Coppolino, other 1/2 with names, info sheets 1–3, branch for info). Quick
    search: the 16-field OR wildcard of `InquirySearchQuery`, ordered by id.
    Advanced search: attorney name, subject, location, branch, referred by,
    resulting case, each a wildcard; date mode between / on-or-after /
    on-or-before. Presets: inquiries by attorney name (ordered by date), and
    how-heard-about-us filtered by a typed source.
  guardrails:
    - Subject accepts free text (journey 02 types one); the legacy subject list is offered as suggestions, not enforced
    - The labels "subject" and "caller name", the save button, and the "Inquiry saved"/"Inquiry created" message match what journey 02 queries
    - Saving creates `/inquiries/<id>` and redirects there
  done when:
    - Filling subject and caller name and saving shows "Inquiry created" and lands on `/inquiries/<new id>` with both values shown
    - Quick search finds a seeded inquiry by a substring of each of the 16 legacy fields, case-insensitively
    - Advanced search date modes return exactly the inquiries between two dates, on or after, and on or before a date, boundaries inclusive
    - Every "sent" checkbox and its paired name field persists on edit
  status: done
  parallel-group: a

- task: Case search and lists — `/cases` with quick search over the `case_search`
    view (substring OR across its 11 columns, case number as text, ordered by
    case number), and `/cases/search` advanced search per legacy
    `frmSearchInput`: a checkbox per field (case #, title, subject, notes,
    status, start date, attorney, client, firm, caption) and an AND/OR toggle;
    only checked fields join the predicate. Case # and status match exactly,
    start date matches cases strictly after the date, the rest are substring
    matches. Empty selection shows "No search values selected". Case lists:
    newest first (start date desc, then case # desc) as the default, the full
    roster by case # (`qryCaseList`), and title-only. Each result row offers a
    print-ready address label (attorney first-name-first, firm, formatted
    address). Logic in `lib/cases/search.ts`.
  guardrails:
    - Search reads `case_search`; if the view is missing, stop and report — do not rebuild it with inner joins in app code
    - Search input is parameterized; `%` and `_` typed by the user match literally
    - A case whose attorney, firm, or client row is missing still appears in every search and list
  done when:
    - Quick search finds fixture case 90001 by "90001", by a substring of "Sample v. Example", and by "Sam Sample"
    - A seeded case whose `caseatty` points at no attorney row is found by its title
    - Advanced AND with title + client narrows to cases matching both; OR with the same fields returns cases matching either; start date returns only cases starting after the date
    - Median of 5 quick searches stays under 1s with 5,000 cases seeded
  caution: true
  status: done
  parallel-group: a

- task: The case record — `/cases/[id]`, per legacy `frmCaseUpdate`. Heading
    contains the case number. Shows firm (name, formatted address, phone, fax),
    attorney (formatted name, email, phone, cell), client. Fields: title,
    subject, notes, caption, start and end date, status (`tblcasestatus`),
    branch (`tblbranches`), attorney and client pickers, priority
    (`tblcasepriority`), sub-priority, waiting for (`tblcasewaitingfor`),
    description, event date, event description, point man (IUO, KJS, RMD, JH,
    Oren, RC, LLB or blank), inquiry link (picker newest-first, with a link to
    the inquiry), other experts, billing alert, billing CC, last change
    (read-only). The record opens locked; an Unlock control enables editing, as
    in legacy. Saving any of status, priority, sub-priority, waiting for,
    description, event date, event description, or point man stamps
    `casestatlastupdated` with now; other edits do not. Badges computed live:
    "Unpaid Bill" when any `tblbills` row for the case has notice 1st, 2nd,
    Final, Partial Payment, Deadbeat, or Small Claims; "Unapproved SA" when any
    `tblsrvauth` row's status does not contain "approved"; "Warning: No Scanned
    Fee Schedule on File" when `numscannedfeeschedule` is 0 and case # > 1850.
    Previous / next case buttons. Empty headed slots "Bills", "Funds
    received", "Expenses" for later lanes. A rolodex-card print view (attorney
    last-name-first, firm, address, phone, fax). Logic in `lib/cases/record.ts`.
  guardrails:
    - Saves write only changed columns; a round-trip save of an unchanged migrated row changes nothing in `tblcase`
    - `numunpaidbills` and `numunapprovedsa` are never written
    - No delete control; the Unlock toggle is UI state, not a database lock
    - A missing attorney/firm/client row renders as blank, never a crash
  done when:
    - `/cases/90001` shows every fixture `tblcase` value, attorney Pat Example, firm Example & Partners LLP, client Sam Sample, and the Bills / Funds received / Expenses headings
    - Unlocking, changing priority, and saving as staff persists it and sets `casestatlastupdated` to now; changing only notes leaves `casestatlastupdated` unchanged
    - Saving an unchanged migrated case writes no `audit_log` row
    - Badges appear exactly when the live counts say so, including a bill with notice "1st" and a service auth "Declined"
  caution: true
  status: done
  parallel-group: b

- task: Case presets — screens under `/cases/lists/`. Work Status: cases whose
    priority is not null and does not contain "9", and whose point man contains
    the chosen point man or is null (blank picker = all), in two sort variants —
    due date present first (legacy base query) and by priority text (legacy
    COPY) — plus a print-ready sheet of the same rows. Waiting For: cases whose
    waiting-for is one of "Initial Advance and Initial Case Material",
    "Initial Advance", "Initial Case Material", with start date, event date,
    description, event description, and the sum of `tblfundsrcvd.fndspmt` for
    the case. Other experts: substring search over `otherexperts`. Recent
    activity: the last 35 days of case status changes (`casestatlastupdated`),
    service-auth approvals (`srvdateapproved`), and new service auths
    (`srvauthdate`), newest first. Logic in `lib/cases/presets.ts`.
  guardrails:
    - The priority rule is the legacy substring test, not "priority != 9"
    - Waiting-for funds sum reads `tblfundsrcvd` only; it never writes
  done when:
    - Against a seeded set, Work Status returns exactly the legacy query's rows — "P9" and null priority excluded, null point man included under any filter — in each variant's order
    - Waiting For lists only the three waiting-for values with the correct funds total per case, 0 for a case with no funds
    - Recent activity includes a 34-day-old status change and excludes a 36-day-old one
  status: done
  parallel-group: b

- task: New case — `/cases/new`, per legacy `frmCaseAdd`. Case number prefilled
    with max(caseid)+1 and editable; title default "TBD", start date default
    today, status default "Open"; subject, caption, branch, attorney picker
    (by last name), client picker (by last name, first name), optional inquiry
    picker. "Add attorney" and "Add client" open the contact create screens and
    return with the new row selected. Saving inserts with the explicit case
    number and redirects to `/cases/<id>`. Logic in `lib/cases/create.ts`.
  guardrails:
    - Always insert an explicit `caseid`; never rely on the identity default (it lags behind migrated ids)
    - A taken case number is refused with a visible "Case number already exists", never a 500
  done when:
    - Opening `/cases/new` prefills max(caseid)+1 and the three legacy defaults; saving creates the row and lands on its record
    - Saving with an existing case number shows "Case number already exists" and inserts nothing
    - Two concurrent saves of the same number yield one row and one refusal
  status: done

- task: Service authorizations on the case page — a panel on `/cases/[id]` per
    legacy `frmCaseServAuth`: date, hours, status, file, notes, advance, newest
    first; add and edit rows. Status is one of Awaiting Approval, Approved
    without advance, Declined, Modified, Modified and Approved, Approved,
    Replaced. Moving a row into Approved or Modified and Approved stamps
    `srvdateapproved` with today unless already set; the date stays
    hand-editable. Lists under `/cases/service-auths/`: Unapproved (Awaiting
    Approval or Modified, by auth date — the menu target), Awaiting approval
    only (by auth date), Recently approved (Approved or Modified and Approved,
    by approval date), and totals (count and hours per status). Rows show case #,
    title, branch, attorney, firm phone, status, hours. Logic in
    `lib/cases/service-auths.ts`.
  guardrails:
    - Status comparisons are case-insensitive; a migrated "awaiting approval" in lowercase appears in both awaiting lists
    - No delete control on a service-auth row
    - Hours keep three decimals (`numeric(9,3)`)
  done when:
    - Adding an auth on case 90001 and moving it to Approved stamps `srvdateapproved` with today; a hand-entered approval date survives the save
    - Seeded "awaiting approval", "Awaiting Approval", and "Modified" rows all appear in Unapproved; only the first two in Awaiting approval only
    - Recently approved orders by approval date; totals match a hand count per status
  caution: true
  status: done

- task: Convert an inquiry to a case — on `/inquiries/[id]`, attorney and client
    pickers (labelled exactly "Case attorney" and "Case client", option values
    are the ids, attorney preselected from
    `inqattyid` when set) and a "Convert to case" button. It creates the case
    with the next case number, title from the inquiry subject, start date today,
    status "Open", branch from the inquiry, the chosen attorney and client, and
    `caseinquiry` = the inquiry id; sets `inqresultingcase` to the new case
    number when it fits a smallint (≤ 32767), else leaves it; then redirects to
    `/cases/<new id>`. An inquiry that already has a case shows a link to it
    instead of the button.
  guardrails:
    - Both writes succeed or neither does — no case without its inquiry link
    - Converting requires an attorney and a client; missing either is refused with a visible message
  done when:
    - Journey 02, amended to pick Pat Example and Sam Sample, passes
    - The created case has `caseinquiry` set to the inquiry and shows firm, attorney, and client on its record
    - A second convert of the same inquiry is not offered; the inquiry page links to its case
  status: done

- task: Wire cases into the app shell — add `{href:"/inquiries",label:"Inquiries"}`
    to `SECTIONS` in `lib/auth/sections.ts`, and put a case quick-search box
    (submits to `/cases?q=`) and an inquiry quick-search box (submits to
    `/inquiries?q=`) on the home page `app/page.tsx`.
  guardrails:
    - Only adds entries and boxes; app-shell's session handling and existing nav stay unchanged
  done when:
    - The header links to /inquiries for both staff and admin
    - Typing "90001" in the home case box lands on `/cases?q=90001` listing case 90001; the inquiry box lands on filtered inquiry results
    - Existing app-shell tests remain passing
  after: app-shell
  status: done

> **⚠️ AUTONOMOUS RUN — STOP HERE**
