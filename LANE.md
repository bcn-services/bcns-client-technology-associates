# Technology Associates — lane: docs-reports

## Objective

Kris and Jon run the practice's month-end and year-end numbers out of the new
app instead of the Access database, and a case's documents live with the case.

Lane done when:
- Journey 06 passes: `/dashboard` shows due/overdue/waiting/unpaid by priority, and P&L, Yearly Expense, and the accountant export all run for a date range
- All six legacy report forms produce the same figures as the client's 2025 Access outputs for the same period
- Every report exports to Excel from the app, with no Access round-trip
- A document uploaded against a case is visible and downloadable from that case's page by an authorized user

**Status.** Last lane of the round. The other six are `done` on `integration`;
journeys are 5 of 6 green and 06 fails at `/dashboard`, which this lane builds.
`/documents`, `/reports` and `/dashboard` are already in the nav
(`lib/auth/sections.ts`) and currently 404 — this lane makes them resolve.

Lane: docs-reports — case documents on Supabase Storage + archive migration, work-status dashboard, P&L / YearlyExpense / accountant export, discovery-confirmed report set

Owned — this lane's items live inside these paths:
  app/documents/**, app/reports/**, app/dashboard/**, lib/documents/**, lib/reports/**, lib/storage.ts, tests/docs-reports/**

Open — merged lanes. Wiring items may edit these; rebase onto `integration` first:
  scripts/migrate/**, tests/migration/**
  app/layout.tsx, app/page.tsx, app/globals.css, app/not-found.tsx, middleware.ts, app/(auth)/**, lib/auth/**, tests/app-shell/**
  app/cases/**, app/firms/**, app/attorneys/**, app/clients/**, app/inquiries/**, lib/cases/**, lib/contacts/**, lib/inquiries/**, tests/cases/**
  app/time/**, lib/time/**, tests/time/**
  app/bills/**, lib/bills/**, tests/billing/**
  app/expenses/**, app/funds/**, app/bank-review/**, lib/expenses/**, lib/funds/**, lib/bank-import/**, tests/money/**

Stop and report if an item requires changing a path outside both lists:
  protected — supabase/migrations/**, lib/db/**, lib/auth/session.ts, lib/auth/client.ts, lib/env.ts, scripts/gen-db-types.mjs, tests/foundation/**, tests/journeys/**, playwright.config.ts, tsconfig.foundation.json
  an unmerged lane's — none; every lane in MAP.md is `done` on `integration`
  unowned — root config (package.json, pnpm-*.yaml, tsconfig, next/eslint config, *.md), .github/workflows, .claude/worktrees, app/api/health, lib/health.ts, lib/ai.ts, lib/webhooks.ts, tests/*.test.mjs, remote sync + backup, bill PDF generation + email

Frozen contracts — build and test against these; they will not move:
  cases, time, billing, money — generated row types in `lib/db/types.ts`
    (`Database["public"]["Tables"][...]`) via the `Tables<T>` helper in
    `lib/db/client.ts`; shapes asserted by `tests/foundation/schema.test.mjs`
    against `tests/foundation/fixtures`

Test against the fixture, not the producing lane. Do not wait for it to exist.

**Global rules — apply to every item.**

- Money is `numeric` in Postgres and is never summed as a JS float. Convert to
  integer cents (`toCents`/`fmtCents`, `lib/expenses/list.ts`), sum as integers,
  format back to a 2-decimal string.
- Every firm-wide query pages manually at 1000 rows — PostgREST caps a response
  there and silently truncates. Follow the `PAGE = 1000` loop in
  `lib/expenses/list.ts` or the `all()` helper in `lib/cases/presets.ts`.
- Legacy table and column names are exact and lowercase (`tblfundsrcvd`,
  `casestatpriority`, `billsecondnoticedate`). Never rename, never alias to a
  tidier name in a query.
- Reports are read-only. No item in this lane writes to `tblexpenses`,
  `tblfundsrcvd`, `tblbills`, `tblcase` or `tblactivity`.
- Queries live in `lib/**` and take the structural `Db` type; pages call them
  with `createServerClient()`. Do not inline a query in a server component.
- Status strings come from the constants that already define them
  (`OPEN_NOTICES` etc. in `lib/bills/rules.ts`). Never re-derive the list.
- Real client figures never enter a committed file. Golden expectations load
  from a gitignored local file; the test self-skips when it is absent.

Fuller context: `CLIENT.md` (brief + config decisions), `LEGACY.md` (legacy
schema and VBA behaviour), `MAP.md` (lane map), `CLAUDE.md` (repo conventions).

## Not yet specified

- Whether the non-CTA branches (FTA, FTA-nonOren, NYTA, CATA) are live entities
  or dead legacy rows — the matrix engine takes the dimension as a parameter, so
  it renders whatever exists; revisit only if a branch report looks wrong
- Whether Kris reads the Monthly Expense Report's type grid positionally —
  revisit after item 4 is on screen in front of her

## Out of scope

- Bulk migration of the scanned archive off the office network shares — gated on the archive's size and location, an open question in `CLIENT.md`; new documents go to Supabase Storage from day one, history stays on the share until a later round
- PDF generation — the rendered report page plus browser print produces the archive copy; a PDF library is a dependency and a rendering layer for something the browser already does
- `.xls` (BIFF8) output matching the legacy binary format — Excel reads `.xlsx` and nothing downstream requires the 1997 format
- Attaching documents to expenses, funds, inquiries, bills or service authorizations — `tblscanneddocument` keeps the FKs, this round wires only `caseid`
- Deleting a document — a delete that orphans a storage object is its own item
- Charts or trend analysis on the dashboard — v1 is counts and a work-status table
- Adding `tests/docs-reports/*.test.mjs` to `package.json`'s `test` script — `package.json` is `unowned:`, so this is a Reviewer edit on `main` (amendment request)

---

- task: Build the detail-list report engine in `lib/reports/detail.ts` — a
    date-range query over `tblexpenses` and `tblfundsrcvd` returning the rows
    behind the legacy Monthly Expense Report (date, type, initials, description,
    reason, check #, amount) and Monthly Income Report (date, attorney,
    description, case #, amount, payee, branch). Takes an optional filter on
    expense type, vendor/description substring, and branch, which is what turns
    the same engine into the `2025_All_Consultants` and
    `2025_Liberum_Advisors_Fees` cuts. Follow the house query-module shape:
    structural `Db` param, `requireSession()` at the entry point, manual 1000-row
    paging, integer-cent sums. Expense rows carry a per-type summary alongside
    the detail rows, limited to types with activity in the period.
  guardrails:
    - Read-only — this module issues no insert, update or delete
    - Rows with `expcaseid`/`fndscaseid` null are firm-wide, not orphans; a date-range report includes them
    - Retired expense types (`tblexptype.active` null or false) still appear when historical rows reference them — `active` gates the picker, never the report
    - Do not re-implement `toCents`/`fmtCents`; import them
  done when:
    - For a given month, the expense rows returned match `tblexpenses` rows in that date range exactly — same count, same order by date, no row from an adjacent month
    - A type filter narrows the result to that type only, and the returned summary totals equal the sum of the returned detail rows to the cent
    - A range spanning more than 1000 matching rows returns all of them, not 1000
    - Median of 5 runs, a full-year detail query returns in under 2s with 50,000 `tblexpenses` and 10,000 `tblfundsrcvd` rows seeded
    - Existing passing tests remain passing
  status: done — commit 8220ebe; perf verified against an in-memory fake (228ms at 50k/10k), NOT against the hosted DB (deliberately not seeded)

- task: Build the month-matrix report engine in `lib/reports/matrix.ts` — given a
    year and a row dimension, return a 12-column grid plus a year total per row
    and a totals row. Dimension `exptype` reproduces the legacy Yearly Expense
    Report (one row per expense type with activity, 26 rows for 2025); dimension
    `branch` reproduces the Yearly Income Report (one row per branch present in
    the data). Reuses the paging and integer-cent helpers from item 1.
  guardrails:
    - A month with no activity for a row renders as empty, never the string "Null" — the legacy form prints `Null` for untouched months and that defect does not carry over
    - A row dimension value present in the data always gets a row, including retired expense types
    - Read-only
  done when:
    - With the 2025 expense data, dimension `exptype` returns rows whose year totals sum to the same grand total as the twelve month-column totals
    - Dimension `branch` returns one row per distinct branch in the range, and a branch with no rows in the range is absent rather than a zero row
    - Empty months are empty in the returned structure, and no cell anywhere contains the string "Null"
    - Existing passing tests remain passing
  status: done — commit 188c16e (3 attempts); the "26 rows for 2025" / "2025 expense data" parity clause is UNVERIFIED — no reachable database holds the client's legacy data (hosted Supabase has smoke rows only). The criterion's property was verified by execution instead.

- task: Build the P&L summary engine in `lib/reports/pnl.ts` — income, expenses
    and net per month for a year plus a Total For Year column, and a separate
    withdrawals row sourced from `tblexpenses.exp_notcountedinprofit`. Accepts an
    as-of month so a partial year returns only elapsed months, which is how the
    client's quarterly CT PTE snapshots (`P&L_03-31-25`, `05-31`, `08-31`) are
    produced. `exp_notcountedinprofit` is a dollar amount, not a boolean flag:
    that amount is excluded from the Expenses line and reported only in the
    withdrawals row.
  guardrails:
    - Never coerce `exp_notcountedinprofit` to a boolean — it is a money column and a non-null value is an amount
    - The withdrawals row is never added into Expenses or Net
    - An as-of month truncates the result; it never zero-fills the remaining months
    - Read-only
  done when:
    - For 2025 the engine returns income 903401.91, expenses 585101.91, net 318300.00 and withdrawals 210000.00, to the cent
    - The expenses total equals the year total the month-matrix engine returns for dimension `exptype` over the same year
    - As-of month 3 for 2025 returns three months and a year total of 59899.19 net, with no entry for April onward
    - Median of 5 runs, a full-year P&L returns in under 2s with 50,000 `tblexpenses` and 10,000 `tblfundsrcvd` rows seeded
    - Existing passing tests remain passing
  status: not started

- task: Build the `/reports` page in `app/reports/` — a server component with
    labelled start-date and end-date inputs, a row of named preset buttons over
    the three engines, and a single results panel carrying
    `data-testid="report-results"` that each preset repopulates. Presets are a
    data table mapping a familiar legacy name to an engine plus its parameters —
    Monthly Expense Report, Monthly Income Report, Yearly Expense Report, Yearly
    Income Report, P&L, and a filtered-expense preset — not six copies of a
    query. Buttons must carry accessible names matching journey 06's selectors:
    `/p&l|profit/i`, `/yearly ?expense/i`, `/accountant export/i`. Hand-rolled
    Tailwind table in the house style; a print stylesheet so browser print
    produces the archive copy.
  guardrails:
    - Native labelled `<input type="date">` pairs — journey 06 finds them with `getByLabel(/start date/i)` and `getByLabel(/end date/i)`
    - One results panel reused by every preset, not one panel per report
    - Adding a preset must not require a new engine or a new route
    - No query logic in the page — it calls `lib/reports/**` and passes `createServerClient()`
  done when:
    - Filling both dates and clicking the P&L preset renders a non-empty `report-results` panel showing twelve month columns and a year total
    - Each of the six presets renders into the same `report-results` panel, replacing the previous result
    - Figures shown on screen for a given range equal what the engine returns for that range, formatted to two decimals
    - Existing passing tests remain passing
  ui: true
  status: not started

- task: Add Excel export in `lib/reports/export.ts` and wire an export control on
    `/reports` — each report exports as a worksheet, and the "accountant export"
    preset produces one combined workbook for a period containing the full set
    the client hands over each January: twelve monthly income sheets, twelve
    monthly expense sheets, and the Yearly Income, Yearly Expense and P&L
    rollups. Use `exceljs`. Headers are readable labels, not the legacy Access
    field names (`FndsBranch`, `ExpDscr`) the old `.xls` dump carried.
  guardrails:
    - Pin `exceljs` and any transitive dependency that trips pnpm's `minimumReleaseAge` in BOTH `package.json` overrides and `pnpm-workspace.yaml` — pnpm 9 reads one, pnpm 11 the other
    - Currency cells carry numeric values with a currency format, never pre-formatted strings
    - Export reads the same engine output the screen renders — it never re-queries with different parameters
  done when:
    - Clicking accountant export for a full year downloads one `.xlsx` containing 27 sheets, each named for its report and period
    - A single report's export opens with its figures matching the on-screen panel to the cent
    - `pnpm build` and `pnpm test` pass with the new dependency installed
    - Existing passing tests remain passing
  ui: true
  status: not started

- task: Build `/dashboard` in `app/dashboard/` — the legacy Work Status Sheet plus
    a header of counts. Four count tiles labelled due, overdue, waiting and
    unpaid, each linking to the existing list page that shows those rows, above a
    work-status table sorted by priority. Composes what already exists rather than
    re-deriving it: `isDue()`, `lastNoticeDate()` and `OPEN_NOTICES` from
    `lib/bills/rules.ts`, and `waitingFor()` and `workStatus()` from
    `lib/cases/presets.ts`.
  guardrails:
    - Do not re-derive the due window, the open-notice list or the priority filter — import them; `workStatus()`'s `casestatpriority not like '%9%'` is a legacy substring match and stays exactly as it is
    - Do not modify `lib/bills/rules.ts` or `lib/cases/presets.ts`; this item only calls them
    - Read-only
  done when:
    - `/dashboard` renders text matching due, overdue, waiting and unpaid, and journey 06's dashboard assertions pass
    - Each tile's count equals the number of rows the list page it links to displays
    - The work-status table is ordered by priority and excludes cases whose `casestatpriority` contains a 9, matching `workStatus()`
    - Existing passing tests remain passing
  after: billing
  ui: true
  status: not started

> **⚠️ AUTONOMOUS RUN — STOP HERE**

- task: Implement the Supabase Storage adapter in `lib/storage.ts` —
    `getStorageAdapter()` currently returns `null` and the `StorageAdapter`
    interface comes from `@nseluga/app-core`. Return a real implementation backed
    by a private Supabase Storage bucket: upload, download and a time-limited
    signed URL for reading. The bucket is private; objects are never served from
    a public URL. Requires the bucket to exist in the hosted project first.
  guardrails:
    - The bucket is private — no item in this lane creates or converts it to public-read
    - Reads are served by short-lived signed URLs; a raw storage URL is never rendered into a page or stored in a row
    - An object key is never derived from user-supplied filename text alone — a guessable key is the same leak as a public bucket
    - `getStorageAdapter()` keeps returning `null` when storage is unconfigured, so an unconfigured environment degrades rather than throws
  done when:
    - Uploading an object then fetching it through the adapter's signed URL returns the same bytes
    - Fetching the object's unsigned storage URL is rejected, and fetching an expired signed URL is rejected
    - Requesting a signed URL for a key that does not exist returns the defined error rather than a 500
    - `getStorageAdapter()` returns null with storage env absent, and no caller throws
  caution: true
  status: not started

- task: Build `/documents` in `app/documents/` plus a documents panel on the case
    page — upload a file against a case, list that case's documents, download one.
    Rows go in `tblscanneddocument` with `caseid` set and the storage key in
    `filename`; query helpers in `lib/documents/`. The panel is the wiring into
    the cases lane: it edits `app/cases/**` so a user reaches documents from the
    case they are already looking at, not only from the nav.
  guardrails:
    - A case's documents panel lists that case's rows only — never another case's, whatever id arrives in the request
    - Upload and download require a session; an unauthenticated request gets the app's normal redirect, never a file
    - Do not add, drop or alter a column on `tblscanneddocument` — the schema is frozen and already carries every field this needs
    - No delete path in this item
  done when:
    - Uploading a file against a case creates one `tblscanneddocument` row with that `caseid`, and the file downloads back with identical bytes
    - The case page's documents panel shows exactly that case's documents, and requesting another case's document id from it does not return that file
    - `/documents` lists uploaded documents and each links to its case
    - Existing passing tests remain passing
  after: cases
  ui: true
  status: not started
