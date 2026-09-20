# Technology Associates — lane: docs-reports

## Objective

Kris and Jon run the practice's month-end and year-end numbers out of the new
app instead of the Access database, and a case's documents live with the case.

Lane done when:
- Journey 06 passes: `/dashboard` shows due/overdue/waiting/unpaid by priority, and P&L, Yearly Expense, and the accountant export all run for a date range
- When the legacy data is loaded into a throwaway database, all six legacy report
  forms produce the same figures as the client's 2025 Access outputs for the same
  period. Gated on the legacy `.bak`: no reachable database holds the practice's
  2025 data, so this criterion stays open until someone loads it.
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

  AMENDMENT (2026-09-19) — narrow protected-path grant, item 6 only: this lane may
  change the single assertion `page.getByText(/due/i)` to `page.getByText(/^due$/i)`
  in `tests/journeys/06-dashboard-reports.spec.ts`, and nothing else in
  `tests/journeys/**`. Reason: item 6 is required to render BOTH a `Due` and an
  `Overdue` tile, so `/due/i` resolves to 2 elements and Playwright raises a
  strict-mode violation; `/^due$/i` resolves to 1. Verified by rendering the page.
  Precedent: the billing lane's journeys amendment (PR #12). `playwright.config.ts`
  and every other protected path stay closed.

  AMENDMENT (2026-09-19) — narrow unowned grant, item 7 only: `supabase/config.toml`
  and `supabase/.gitignore` may be created, to stand up a LOCAL Supabase stack for
  testing. `supabase/migrations/**` stays protected and frozen — no migration is
  added, edited or run against any hosted project. No other unowned path opens, and
  MAP.md is not edited.

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
  from a gitignored local file; the test self-skips when it is absent. That file
  is `tests/docs-reports/golden.local.json` (gitignored). Until it exists, every
  criterion below that names a 2025 figure is checked as a property, not a number.

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
    - Dimension `exptype` returns rows whose year totals sum to the same grand total as the twelve month-column totals, and one row per expense type with activity in the year. With `tests/docs-reports/golden.local.json` present, the row count and figures also match its Yearly Expense expectations; the test self-skips when it is absent
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
    - The engine returns income, expenses, net and withdrawals per month plus a Total For Year column, with net equal to income minus expenses to the cent in every column and the year total equal to the sum of its months. With `tests/docs-reports/golden.local.json` present, the 2025 figures match its P&L expectations; the test self-skips when it is absent
    - The expenses total equals the year total the month-matrix engine returns for dimension `exptype` over the same year
    - As-of month 3 returns exactly three months with no entry for April onward, and its Total For Year column covers only those three months
    - Median of 5 runs, a full-year P&L returns in under 2s with 50,000 `tblexpenses` and 10,000 `tblfundsrcvd` rows seeded
    - Existing passing tests remain passing
  status: done — commit fb22e97 (2 attempts). Criteria 2, 3-structural, 4 (207ms vs 2000ms budget, in-memory fake only) and 5 verified by execution. Criteria 1 and 3's exact figures UNVERIFIABLE — no reachable database holds the client's 2025 data. OPEN DATA QUESTION: the engine treats `exp_notcountedinprofit` as a column separate from `expamount` (so a draw is a memo row, never netted out). If a real withdrawal row also carries an `expamount`, expenses are overstated and criterion 2 must be dropped. Needs the `.bak`.

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
    - Figures shown for a preset equal what that preset's engine returns for the parameters the preset derives from the submitted range, formatted to two decimals, and the panel caption states the period actually rendered
    - Existing passing tests remain passing
  ui: true
  status: done — commits f0948e0 (page) + d2ebff9 (tests). Criteria 1, 2 and 4 verified by execution (58/58 own tests, full suite at baseline 986/771/0/215, `next build` green, eslint clean). Criterion 3 verified against the 2026-09-19 amendment, which resolved its contradiction with criterion 1. Auth independently re-proved live: unauthenticated `/reports` returns 307 to `/login?next=%2Freports` with a 22-byte body and no figures, on Next 14.2.18. CAVEAT, same standing one as items 1-3: the authenticated browser pass and journey 06 did not run — `.env.local` points at the client's live hosted Supabase, which this lane may not seed, and no throwaway database exists. Presets are proved against an in-memory fake, not a browser session.

- task: Add Excel export in `lib/reports/export.ts` and wire an export control on
    `/reports` — each report exports as a worksheet, and the "accountant export"
    preset produces one combined workbook for a period containing the full set
    the client hands over each January: twelve monthly income sheets, twelve
    monthly expense sheets, and the Yearly Income, Yearly Expense and P&L
    rollups. Use `exceljs`. Headers are readable labels, not the legacy Access
    field names (`FndsBranch`, `ExpDscr`) the old `.xls` dump carried.
  guardrails:
    - AMENDMENT (2026-09-19): this item may edit `package.json` and the generated
      `pnpm-lock.yaml`, which MAP.md lists `unowned:`. Authorized for this item
      only, for the two changes named in these guardrails. No other unowned path
      is open, and MAP.md itself is not edited.
    - Add `exceljs` as a plain `dependencies` entry in `package.json`. Do NOT edit
      `pnpm-workspace.yaml`: this repo declares no `overrides` anywhere and
      `minimumReleaseAge` is unset everywhere, so a pin there is dead config. The
      previous guardrail asserting otherwise was factually wrong and is withdrawn
    - Append `tests/docs-reports/*.test.mjs` to `package.json`'s `test` script.
      That script names directories explicitly, so this lane's tests do not run
      under `pnpm test` today and the gate below is vacuous without this line
    - Run every tool through `pnpm exec`, never bare `npx` — with a broken
      `node_modules`, `npx next` silently fetched Next 16 from the registry and
      ran it against this Next 14 repo
    - Currency cells carry numeric values with a currency format, never pre-formatted strings
    - Export reads the same engine output the screen renders — it never re-queries with different parameters
  done when:
    - Clicking accountant export for a full year downloads one `.xlsx` containing 27 sheets, each named for its report and period
    - A single report's export opens with its figures matching the on-screen panel to the cent
    - `pnpm build` and `pnpm test` pass with the new dependency installed, and `pnpm test`'s reported test count rises above the 986 baseline — proving `tests/docs-reports/` now runs under it
    - Existing passing tests remain passing
  ui: true
  status: done — commits 6b20aa7 (build) + 2d69efb (QA tests), 1 attempt. Criteria 1 and 2 verified by execution: `accountantPlan(2025)` yields exactly 27 uniquely-named sheets, longest 31 chars (Excel's cap) with no illegal characters, and QA proved "same engine output as the screen" by tracing every fake-Db call and deep-equalling `buildWorkbook`'s trace against `runPreset`'s — zero re-query. Criterion 3 verified: `pnpm test` 986 -> 1056 tests, 771 -> 841 pass, 0 fail, skip unchanged at 215, so `tests/docs-reports/` genuinely runs now; `pnpm build` exit 0 with `/reports/export` listed dynamic. CAVEAT, same standing one: headless run, live-Supabase-only, so the route's auth gate, its `content-disposition` header and the actual click are unexercised at runtime. NOTE: sheet names sit at Excel's 31-char limit exactly — a longer preset label would truncate and collide across months; abbreviate rather than slice.

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
    - AMENDMENT (2026-09-19): each tile's count is derived from the same rule as
      the page it links to, and the tile links to the page that lists those rows.
      Where no narrower page exists yet the link may point at a superset page —
      `due` links to `/bills` and `overdue` to the work-status list, both of which
      list more rows than the tile counts. The count stays exact; the destination
      is the closest page this lane can reach. Building a due-only or overdue-only
      view belongs to `app/bills/**` / `app/cases/**`, merged lanes this one does
      not own. The previous wording was unsatisfiable from inside this lane.
    - The work-status table is ordered by priority and excludes cases whose `casestatpriority` contains a 9, matching `workStatus()`
    - Existing passing tests remain passing
  after: billing
  ui: true
  status: done, with two criteria UNMET — both are plan defects outside this lane's ownership, not code defects. Commits 7731ae6 (build) + b145416 (QA proof), 1 attempt, QA VERDICT PASS. Built `app/dashboard/page.tsx` over a new injectable `lib/reports/dashboard.ts`; `lib/bills/rules.ts` and `lib/cases/presets.ts` are imported, never modified (verified: neither file appears in the diff). Suite 1056 -> 1074 tests, 841 -> 859 pass, 0 fail, skip unchanged. Criteria 3 and 4 verified by execution.
    UNMET 1 — criterion 1 cannot pass as written. Journey 06 asserts `expect(page.getByText(/due/i)).toBeVisible()`, but this item is required to render BOTH a `Due` and an `Overdue` tile, so the regex matches two elements and Playwright raises a strict-mode violation. Independently confirmed by rendering the page: `/due/i` matches exactly 2 leaf elements (`Due`, `Overdue`); `/overdue/i`, `/waiting/i` and `/unpaid/i` each match exactly 1. The one-word fix is `/^due$/i`, which narrows it to 1 — but it lives in `tests/journeys/06-dashboard-reports.spec.ts`, a `protected:` path. NEEDS a protected-path amendment, same shape as the billing lane's journeys amendment (PR #12).
    UNMET 2 — criterion 2 is unsatisfiable for 2 of the 4 tiles. No existing page renders a due-only or overdue-only subset: `due` links to `/bills` (all open bills) and `overdue` to the work-status list (all work-status rows), so those two tiles are honest counts pointing at a superset page. `waiting` and `unpaid` do match their pages exactly. Fixing it would mean building filtered views in `app/bills/**` / `app/cases/**`, which belong to merged lanes, not this one. NEEDS a human decision: amend the criterion, or open a follow-up item against those lanes.

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
  status: done — commits 1539c3f (build) + a6e420b (review fixes), merged 6ff82dc; 2 attempts, caution: true, team dt-engineer + dt-qa + dt-review. All four criteria verified by execution against a LOCAL Docker Supabase stack stood up for this lane (tests/docs-reports/local-stack-setup.sh); the client's hosted project is never written to. The private `case-documents` bucket is created by that test setup, never at runtime. dt-review caught two real defects, both fixed: an error taxonomy keyed on HTTP status, where `NoSuchBucket` and `NoSuchKey` both return 404 so "storage misconfigured" surfaced as "document does not exist"; and an unpaged `listKeys` silently capped at 100 objects. Signed-URL TTL is clamped to 900s. NOTE: item 8 later modified this file (+35/-8) — see item 8's status.

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
  status: done — commits 28ddcc0 (build) + 518af27 / f681347 (QA tests) + b2e1b04 (QA fix); 2 attempts, QA VERDICT PASS on re-gate. All four criteria and all four guardrails verified live over real HTTP against `next dev` with a genuine Supabase SSR session cookie and two seeded cases (90001 / 90003): upload creates exactly one row with that caseid, download returns byte-identical bytes, and neither case can reach the other's document by id, key or list. Exactly 2 lines added to `app/cases/[id]/page.tsx`. `supabase/migrations/**` untouched. QA refuted attempt 1's claim that item 7's bucket-vs-key conflation was not repeated — Supabase's `object/sign` returns `code:"NoSuchKey"` for a missing BUCKET too, byte-identical to a missing key — so `lib/storage.ts` gained a `getBucket` probe that fails closed. CAVEAT: browser QA never ran (the Chrome extension is bound to a different claude.ai account); the live-HTTP behavioural pass was accepted in its place.
