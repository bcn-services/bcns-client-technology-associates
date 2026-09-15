# Technology Associates — Lane Progress

One row per lane in `MAP.md`. Written only during `/merge-lane`. Append-only
across rounds — never reset. Per-item detail lives in `progress/<lane>.md`.

## Round: full v1 → go-live

| Lane | Assignee | Branch | Status |
|------|----------|--------|--------|
| migration | nate | lane/migration | done — 4/4 items, merged 2026-09-09 (`a3add4b`) |
| app-shell | nate | lane/app-shell | done — 12/12 items (7 planned + 5 polish), merged 2026-09-10 (`464ab58`) |
| cases | nate | lane/cases | done — 9/9 items, merged 2026-09-11 (`298b6ac`, PR #4) |
| time | nate | lane/time | done — 6/6 items + 3 click-through fixes, merged 2026-09-12 (`9b8d68f`, PR #9) |
| billing | nate | lane/billing | done — 9/9 items + suite/seed fixes, merged 2026-09-13 (`c663304`, PR #11; journeys amendment PR #12) |
| money | nate | lane/money | done — 12/12 items (11 + check → bill link), merged 2026-09-15 (`075c477`, PR #13; `819ecef`, PR #14) |
| docs-reports | nate | — | not started — no LANE.md yet |

**Journeys:** 5 of 6 green (2026-09-15, after money; `--workers=1`). 01–05 pass. 06 fails at the
dashboard, which docs-reports builds. Progress reading, not a merge gate.

**Amendments this round**

- 2026-09-09 — `supabase/migrations/0006_trial_load_fixes.sql` (PR #2, `2cab8db`).
  Three schema defects found by trial-loading the client's real `.bak`: 17 `bit`
  columns lose `not null`, three hours columns widen to `numeric(9,3)`, and phantom
  `tblcase.casestatusharddeadline` is dropped. `FOUNDATION.md`'s type map and
  `lib/db/types.ts` were amended to match. Any live lane must rebase onto
  `integration` before assuming the frozen shapes.
- 2026-09-10 — `tests/journeys/helpers.ts` (`966a523` on `main`). `login()` now awaits
  the redirect off /login; the next `page.goto` was aborting the sign-in POST.
- 2026-09-12 — `MAP.md` migration lane `area:` gains the NAS Excel timesheet history
  import (per-person workbooks, one sheet per case, columns `[Date, Task, Dec, Sub,
  Fee($), Billed]`) into `tblactivity`. Surfaced by `/lane time`: the time lane
  replaces the workbooks going forward but would leave their history unreachable.
  Gated on Kris's workbook samples and on whether the migrated `tblactivity` rows
  are real; not an item until then. Expected on the time merge: journey 03's closing
  `getByText(/billed/i)` becomes ambiguous once the case page shows "Unbilled hours"
  and per-row billed markers — protected-path amendment for the billing lane, scope
  it to the bill panel.
- 2026-09-13 — `tests/journeys/**` (PR #12, `amend/journey-03`, on `integration`: 03
  needs billing, which main lacks). `login(page,'admin')` now signs in as
  `E2E_ADMIN_EMAIL` (seeded by `seed-e2e.ts`); it was the staff account. 03 awaits
  the create-bill redirect, asserts `billed-marker`, and cleans its rows off case
  90001. 02 asserts the Firm/Attorney/Client headings, not `getByText(/firm/i)`.
- 2026-09-15 — money lane (PR #14, approved by Nate). `supabase/migrations/0008_funds_bill_link.sql`
  adds nullable `tblfundsrcvd.fndsbillid` FK → `tblbills.billid`, applied to hosted and local
  `ta_foundation`; `lib/db/types.ts` regenerated. Every cleanup now deletes funds before bills.
  Journeys 04/05 are rerun-safe (own fixtures, 05 clicks Import). `tests/foundation/schema.test.mjs`
  excludes the app-added FK from the legacy "26 NOT VALID" count.
