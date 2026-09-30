# Technology Associates — lane: billing-output

## Objective

Kris and Kalpna finalize, price, and email every bill from the app, the way the
Access database does today, and the case app writes the service authorization
document the attorney signs.

Lane done when:
- Journey 07 passes: an admin finalizes a timesheet bill with one person's rate changed, previews the PDF and the email, sends it, and the case shows the stored PDF and the charged rates
- Each of the 6 bill types renders a PDF whose lines, hours, rates and totals equal what `modBillingAndServAuth.bas` computes for the same inputs (synthetic fixtures, not client figures)
- A 2nd or Final notice resends the stored bill with its stamp and the legacy notice email; the notice sequence dates are untouched by the send
- Creating a service authorization produces its document, a `tblsrvauth` row in "Awaiting Approval", and the approval date follows the legacy stamp rule

**Status.** First lane of the 2026-09-21 amendment. All seven round-1 lanes are
`done` on `integration`. Bills today are records only: type, hours pulled from
unbilled time, a hand-typed balance, notice dates, revisions. This lane turns
them into priced, rendered, sent invoices. Legacy reference: VBA in
`~/Downloads/TA_Files/vba-source/` (not in git) — `modBillingAndServAuth.bas`,
`Form_frmCaseBill.bas`, `Form_frmBillUnpaid.bas`, `Form_frmCaseServAuth.bas`.
Layout reference: the sample invoice `Bill2805 … 2026 07 13-0.pdf` in Nate's
client files (not in git; never copy its figures into a committed file).

Lane: billing-output — bill PDFs for all 6 types, per-person rate at finalize (admins only), Preview-then-Send email, 2nd/Final notice resend, service authorization document + legacy approval-date rule

Owned — this lane's items live inside these paths:
  app/bills/**, lib/bills/**, lib/bill-docs/**, app/cases/[id]/service-auths.tsx, app/cases/[id]/sa-submit.tsx, app/cases/service-auths/**, lib/cases/service-auths.ts, tests/billing-output/**
  (app/bills + lib/bills taken over from billing, done; the service-auth files from cases, done)

Open — merged lanes. Wiring items may edit these; rebase onto `integration` first:
  scripts/migrate/**, tests/migration/**
  app/layout.tsx, app/page.tsx, app/globals.css, app/not-found.tsx, middleware.ts, app/(auth)/**, lib/auth/**, tests/app-shell/**
  app/cases/** (outside the owned SA files), app/firms/**, app/attorneys/**, app/clients/**, app/inquiries/**, lib/cases/** (outside service-auths.ts), lib/contacts/**, lib/inquiries/**, tests/cases/**
  app/time/**, lib/time/**, tests/time/**
  tests/billing/**
  app/expenses/**, app/funds/**, app/bank-review/**, lib/expenses/**, lib/funds/**, lib/bank-import/**, tests/money/**
  app/documents/**, app/reports/**, app/dashboard/**, lib/documents/**, lib/reports/**, lib/storage.ts, tests/docs-reports/**

Stop and report if an item requires changing a path outside both lists:
  protected — supabase/migrations/**, lib/db/**, lib/auth/session.ts, lib/auth/client.ts, lib/env.ts, scripts/gen-db-types.mjs, tests/foundation/**, tests/journeys/**, playwright.config.ts, tsconfig.foundation.json
  an unmerged lane's — case-docs (lib/case-docs/**, app/cases/[id]/documents/**, tests/case-docs/**), parity (scripts/parity/**, tests/parity/**)
  unowned — root config (package.json, pnpm-*.yaml, tsconfig, next/eslint config, *.md), .github/workflows, .claude/worktrees, app/api/health, lib/health.ts, lib/ai.ts, lib/webhooks.ts, tests/*.test.mjs, remote sync + backup

  AMENDMENT (2026-09-21) — protected-path grant, item 1 only, approved by Nate with
  the MAP amendment: add `supabase/migrations/0009_bill_output.sql` (shape in item 1),
  regenerate `lib/db/types.ts` with `pnpm db:types`, extend
  `tests/foundation/schema.test.mjs` + fixtures for the new table and columns, add
  the item-1 keys to `lib/env.ts`, and add `tests/journeys/07-bill-send.spec.ts`
  (ships red). Migration 0009 is applied to a LOCAL Supabase stack only — never
  `supabase link`, never pushed to the hosted project from this lane.

  AMENDMENT (2026-09-21) — unowned grant, item 4 only: `package.json` +
  `pnpm-lock.yaml` may add ONE pure-JS PDF library (`pdf-lib` preferred). No
  headless browser, no native build step.

  AMENDMENT (2026-09-21) — unowned grant, item 5 only: `package.json` +
  `pnpm-lock.yaml` may add `resend`. A plain `fetch` to the Resend REST API is
  acceptable instead and needs no grant.

Frozen contracts — build and test against these; they will not move:
  cases, time, billing, money — generated row types in `lib/db/types.ts` via
    `Tables<T>` in `lib/db/client.ts`; shapes asserted by
    `tests/foundation/schema.test.mjs` against `tests/foundation/fixtures`
  session — `requireSession()` / `Session.role` in `lib/auth/session.ts`
  storage — `getStorageAdapter()` / `STORAGE_BUCKET` in `lib/storage.ts`
  unbilled work — `actbilled = false and actbillid is null` (migration 0002)

Test against the fixture, not the producing lane. Do not wait for it to exist.

**Global rules — apply to every item.**

- Finalizing a bill, editing a rate, sending a bill, and sending a notice are
  **admin-only** (Kris, Kalpna). Check `session.role === "admin"` in the server
  action itself, not only by hiding the button. Staff see the result read-only.
- Nothing is ever emailed without a preview. Every send is two steps: Preview
  (To / CC / BCC / subject / body shown and editable, PDF attached and openable),
  then Send. A double submit sends once.
- Money never passes through a JS float. Hours are thousandths (`thousandths` in
  `lib/time/week.ts`), rates are integer cents, a line amount is
  `round_half_up(hours × rate)` to **whole dollars** — the legacy
  `Int(hours*rate+0.5)` — and the printed amount is `#,###` with no cents.
- Default rates live in ONE place, `lib/bills/rates.ts`, as the legacy 2026
  values: standard $435 / testimony $490; once the bill date is more than 2 years
  after `casestartdate`, $475 / $535. The legacy testimony map (435→490, 415→470,
  400→450, 375→425, 350→400) derives testimony from a standard rate an admin
  types. These are guesses until Kris sends the rate card — never scatter them.
- A person's default rate = standard rate × their `tblbillingnames.billingfactor`.
  The rate actually charged is whatever the admin leaves in the box, stored on the
  bill line. Re-rendering a bill always uses the stored line, never today's default.
- One branch only (Stratford). No branch picker; the legacy `Branch & "_Bill.dotm"`
  template choice collapses to one layout.
- Legacy table and column names are exact and lowercase. Never rename or alias.
- Legacy bills (`billtype` null, no lines) render nothing new: no Finalize, no PDF,
  no Send. They keep working exactly as today.
- Queries live in `lib/**`, take the structural `Db` type, and page at 1000 rows.
- Real client figures, names, and addresses never enter a committed file. Tests
  use synthetic cases. The firm's letterhead text is config (item 1), not code.
- `lib/env.ts` stays lazy. With no email keys set, Preview still renders and the
  PDF still downloads; Send is disabled with a plain message saying email is not
  configured.

Fuller context: `CLIENT.md`, `LEGACY.md` (schema + VBA addendum), `MAP.md`,
`PARITY.md` (when present), `CLAUDE.md`.

## Not yet specified

Each has a guess the lane builds to. Nate is asking Kris; the answer changes the
named constant or template, not the design.

- Retainer / depo prep / depo / trial bill samples — build the lines verbatim
  from `modBillingAndServAuth.bas` (item 2 lists them)
- `ServAuth.dotx` layout — never sent; build from the bookmarks the VBA fills
  (item 7), laid out like the two sample SAs in
  `~/Downloads/TA_Files/Nate_Examples/1/` (real client data, not in git — read
  for layout only, never copy a name or figure into a committed file)
- The sending address and DNS for technology-assoc.com — config key; until DNS is
  verified in Resend, Send is disabled per the env rule
- Whether Jon's hours bill at the same rate as Kris's — default both to
  standard × billingfactor; the admin edits at finalize
- Whether `billingfactor` scales hours or rate — the amount is identical; scale
  the rate so printed hours match hours worked
- The legacy timesheet bill groups rows by the workbook's `Sub` column — the app
  has no `Sub`; one line per activity row, date `M/D/YY`, ordered by date
- Whether the Word doc's yellow BillingAlert highlight ever reached the attorney —
  guess no: the app shows the alert as an on-screen warning at finalize and send,
  never on the PDF
- Who sends notices now (legacy: front-desk PC only) — admins only

## Out of scope

- Reading the NAS Excel timesheets or the per-case rate in cell O1 — migration
  lane's gated timesheet import; bills price from `tblactivity`
- A real rate card with effective-date history — later, when Kris sends it
- Per-case rate overrides — the per-person rate at finalize covers it this round
- The 4 case Word documents (Inspection Plan, Memo, CTA Report, File Review
  Summary) — case-docs lane
- Mailing paper copies — the Final notice email says "A copy has also been mailed
  via USPS." as legacy does; printing stays manual
- Tracking replies, bounces or opens — Send records who and when, nothing after

---

- task: Schema and config for bill output. Add `supabase/migrations/0009_bill_output.sql`:
    table `tblbilllines` (`lineid` identity pk, `billid` int not null → `tblbills.billid`
    on delete restrict, `lineno` int not null, `kind` text not null check in
    ('charge','estimate','credit','expense'), `linedate` date null, `description`
    text not null, `personid` int null → `tblbillingnames.personid`, `hours`
    numeric(9,3) null, `rate` numeric(10,2) null, `amount` numeric(12,2) not null,
    unique (`billid`,`lineno`)), plus nullable `tblbills` columns `billfinalizedat`
    timestamptz, `billpdfpath` text, `billsentat` timestamptz, `billsentto` text.
    RLS and the audit trigger match every other table (migrations 0003, 0005).
    Regenerate types, extend the foundation schema test and fixtures. Add to
    `lib/env.ts`: `RESEND_API_KEY`, `BILL_FROM_EMAIL`, `BILL_CC_EMAIL` (legacy:
    Kalpna), `NOTICE_BCC_EMAIL` (legacy: Kris), `BILL_TAX_ID`, `BILL_LETTERHEAD`
    (multi-line firm name/address/phone/web). Write journey 07 red.
  guardrails:
    - Additive only — no existing column changes type, nullability, or default
    - Applied to a local Supabase stack only; the hosted project is never touched from this lane
    - Every new env key is optional and read at call time; the app builds with none set
    - No other protected path changes
  done when:
    - `tests/foundation/schema.test.mjs` passes with the new table and columns asserted against a fixture, and the existing "26 NOT VALID" count is unchanged
    - `pnpm build` succeeds with zero env vars set
    - Journey 07 exists under `tests/journeys/` and fails on a missing Finalize control, not on a syntax or setup error
    - Existing passing tests remain passing
  caution: true
  status: done (2026-09-28)

- task: Build the pricing engine in `lib/bills/lines.ts` + `lib/bills/rates.ts` — pure
    functions, no DB, no clock. Input: bill type, bill date, case start date, the
    bill's activity rows (date, description, hours, personid), the people's
    billing factors, prior `tblfundsrcvd` rows for the case, and any admin rate
    overrides per person. Output: ordered lines plus hours total and balance due.
    Per type, from `modBillingAndServAuth.bas`: blank → no lines; retainer →
    "Initial Advance" 4,500; timesheet → one line per activity row, then one
    total line per distinct (person, rate): "`<h>` hrs x $`<rate>`/hr"; depo prep →
    "Review file, prepare for deposition & telecom(s)/meet with atty." 8 hrs
    (est.) × rate; depo → "Deposition (via Zoom)" 6 hrs × testimony rate; trial →
    "Review file and prep for trial" 6 hrs + "Telecom w/ atty." 2 hrs = 8 hrs ×
    rate, "Travel & court time" 10 hrs × testimony rate, "Expenses: Travel to
    court & parking" $100, balance marked "(est.)". Estimate hours and amounts are
    defaults the admin may edit. Prior funds list as credit lines (date, type,
    amount) before the charges, as the legacy timesheet bill does.
  guardrails:
    - Whole-dollar half-up rounding per total line, integer math only (global rule)
    - The two-year rule compares the BILL date to `casestartdate`, not today
    - An override for one person never changes another person's line
    - Balance due = charges + expenses − credits; a bill with credits exceeding charges shows a negative balance, never clamps to 0
  done when:
    - For each of the 6 types, a synthetic fixture produces exactly the legacy lines, hours, and total the VBA computes for the same inputs (fixture values derived by hand from the VBA and written in the test)
    - 10.5 hrs at $435 yields a $4,568 line; 0.125 hrs at $435 yields $54; the rule is proven on ≥3 half-dollar boundary cases
    - A bill dated 2 years + 1 day after case start prices at $475/$535 by default; 2 years exactly prices at $435/$490
    - Existing passing tests remain passing
  caution: true
  status: done (2026-09-28)

- task: Build Finalize at `/bills/[id]/finalize` — admin-only. Shows the bill's
    lines from item 2 with one rate box per person (default + "default $X" hint),
    editable hours/amounts on estimate lines, the credits, and a live total. Save
    writes `tblbilllines`, `billhours`, `billbalance`, and `billfinalizedat` in
    one guarded operation. The create form (`/bills/new`) stops asking for a
    balance on typed bills — it is computed here. A finalized bill is locked:
    changes go through the existing Revise, and a revision's Finalize pre-fills
    from the superseded bill's stored lines and rates. Show the case's
    BillingAlert as a warning banner.
  guardrails:
    - Server action rejects non-admins with 403 regardless of UI
    - Save is guarded on `billfinalizedat is null` and on the lines the page rendered, so a stale or double submit changes 0 rows and returns ?error=stale
    - Legacy bills (billtype null) show no Finalize control
    - Total shown on screen equals the total saved, computed by the same item-2 function
  done when:
    - An admin changes one person's rate, saves, and the stored line carries that rate while the other person's line keeps the default
    - A staff session gets 403 on the action and sees no Finalize control
    - Re-opening a finalized bill shows stored values even after `lib/bills/rates.ts` defaults change
    - Existing passing tests remain passing
  ui: true
  caution: true
  status: done (2026-09-28)

- task: Render the invoice PDF in `lib/bill-docs/invoice.ts` from a finalized
    bill's stored lines — layout of the legacy sample: letterhead block (from
    `BILL_LETTERHEAD`), "INVOICE", "TAX ID: …", attorney block ("First Last,
    Esq.", firm, address), "DATE: `mmmm dd, yyyy`", "RE: `<caption>`", client name,
    "Our File No.: `<caseid>`", table Date / Reference / Charges / Credits /
    Balance, total line(s), "Balance due: $X", the 3-line footer. Save to storage
    at `bills/<caseid>/<billfilename>.pdf` using the legacy name from
    `billFileName()` (strip `- _ / '`, unique `-N` suffix), set `billfilename` and
    `billpdfpath`. Download link on the bill page and in the case bills panel.
  guardrails:
    - Renders only from stored lines — never re-prices
    - Missing optional fields (no middle name, no address2, no client) collapse their row, never print "null" or blank labels
    - No figures from the real sample bill in any test or fixture
    - One new dependency at most (grant above)
  done when:
    - A synthetic timesheet bill's PDF text (extracted in the test) contains every line, the total line, and "Balance due" with the stored amount
    - The stored object exists at `billpdfpath` and downloads with `Content-Type: application/pdf` for a signed-in user, 401/redirect for anon
    - Two bills for the same case, attorney and date get `-1` and `-2` file names
    - Existing passing tests remain passing
  ui: true
  status: done (2026-09-28)

- task: Build Preview-then-Send at `/bills/[id]/send` — admin-only, finalized bills
    only. Preview pre-fills To = the attorney's `attyemail`; CC = `BILL_CC_EMAIL`
    plus the case's `billingcc`; subject "Re: `<casecaption>`"; body "Atty.
    `<Last>`,\n\nPlease see the attached invoice for the recent work on this case.
    Let me know if you have any questions.  Thank you."; the PDF attached and
    openable. All fields editable. BillingAlert shows as a warning that must be
    ticked before Send enables. Send goes through Resend from `BILL_FROM_EMAIL`
    and records `billsentat` + `billsentto`. A sent bill shows "Sent <date> to
    <addr>" and offers Send again (new preview).
  guardrails:
    - Server rejects non-admins, unfinalized bills, and empty or malformed To addresses before calling Resend
    - Idempotent: a double submit sends once (guard on a per-preview token or `billsentat` unchanged since render)
    - No email keys → Preview works, Send disabled with a plain message, nothing thrown
    - A Resend failure records nothing and shows the provider's error; it never marks the bill sent
  done when:
    - With Resend mocked, Send delivers one message with the edited To/CC/subject/body and the PDF attachment, and sets `billsentat`
    - A double submit produces one provider call
    - A staff session gets 403; with no `RESEND_API_KEY` the page renders and Send is disabled
    - Existing passing tests remain passing
  ui: true
  caution: true
  status: done (2026-09-30)

- task: Build notice resend on bills at 2nd or Final — from the bill page and the
    unpaid list, a "Send notice" action with the same Preview-then-Send flow.
    The PDF is the stored invoice with a stamp overlaid (left 150pt, top 250pt):
    the legacy image `lib/bill-docs/stamps/SecondNotice.png` for 2nd,
    `FinalNotice.png` for Final, saved beside the original as `<billfilename> SecondNotice.pdf` /
    `FinalNotice.pdf`. Email: To attorney, CC `billingcc`, BCC `NOTICE_BCC_EMAIL`,
    subject "Re: `<casecaption>`", body "Dear Atty. `<Last>`,\n\nAttached is a
    copy of an invoice that is past due in the subject matter." + for Final "A copy
    has also been mailed via USPS." + "\n\nPlease contact us if there are any
    questions.\n\nThank you,".
  guardrails:
    - Sending a notice never changes `billnotice` or the notice dates — advancing stays the existing Advance action
    - Only bills with a stored PDF offer it; legacy bills without one show why
    - Admin-only, previewed, idempotent, degrades without keys — same as item 5, reusing its send path, not a copy
  done when:
    - A 2nd-notice bill's notice PDF contains the stamp text and every original line; the original PDF is unchanged
    - The mocked send carries the BCC and the notice body variant for 2nd vs Final
    - `billnotice`, `billsecondnoticedate`, `billfinalnoticedate` are byte-identical before and after a send
    - Existing passing tests remain passing
  ui: true
  caution: true
  status: not started

- task: Service authorization document. On the case's SA panel, "Create SA" (any
    signed-in user) renders a PDF from the case: Sub = caption / title /
    "#`<caseid>`"; Atty = "First Last, Esq." + firm phone; Firm; Date (short
    date); Rate (the item-2 default for the date); and a Date / Services performed
    / Hrs table of the case's unbilled work since the last invoice. Saves to
    storage as `SA<caseid> <atty last> <yyyy mm dd>-N.pdf`, inserts a `tblsrvauth`
    row (today, requested hours, "Awaiting Approval", `srvauthfile` = name), and
    offers the download. Also bring the approval-date rule to legacy
    (`frmCaseServAuth.SrvAuthStatus_AfterUpdate`): status Approved, Declined,
    Modified, or Modified and Approved → set `srvdateapproved` to today when null;
    any other status → clear it. Layout reference: the sample SAs named under
    "Not yet specified".
  guardrails:
    - The existing SA edit form, lists and totals keep working; only the stamp rule changes
    - "Since the last invoice" = unbilled rows (the frozen definition), not a date cutoff
    - No SA is ever emailed from the app this round — the document is downloaded
  done when:
    - Create SA on a synthetic case yields a PDF containing its caption, case number, rate and each unbilled row, plus a new "Awaiting Approval" row whose `srvauthfile` matches the stored object
    - Setting status to Declined stamps today when empty; setting it back to Awaiting Approval clears it; Approved on a row with a date keeps the date
    - The pending and approved lists at `/cases/service-auths` reflect both changes
    - Existing passing tests remain passing
  ui: true
  status: not started

- task: Wire bill output into the app — the case bills panel and `/bills` list show
    each bill's state (Draft / Finalized / Sent `<date>`) with Finalize, Download,
    Send, and Send notice where they apply; the unpaid view gets Send notice.
    Make journey 07 green.
  guardrails:
    - Legacy bills show exactly what they show today
    - Staff see state and Download, never Finalize/Send
    - Only the grant-listed journey file changes under `tests/journeys/`
  done when:
    - Journey 07 passes against a local Supabase stack with `--workers=1`
    - Journeys 01–06 still pass under the same run
    - Existing passing tests remain passing
  ui: true
  status: not started
