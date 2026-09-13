# Technology Associates — Lane Progress

One row per lane in `MAP.md`. Written only during `/merge-lane`. Append-only
across rounds — never reset. Per-item detail lives in `progress/<lane>.md`.

## Round: full v1 → go-live

| Lane | Assignee | Branch | Status |
|------|----------|--------|--------|
| migration | nate | lane/migration | done — 4/4 items, merged 2026-09-09 (`a3add4b`) |
| app-shell | nate | lane/app-shell | done — 12/12 items (7 planned + 5 polish), merged 2026-09-10 (`464ab58`) |
| cases | nate | lane/cases | done — 9/9 items, merged 2026-09-11 (`298b6ac`, PR #4) |
| time | nate | — | not started — no LANE.md yet |
| billing | nate | — | not started — no LANE.md yet |
| money | nate | — | not started — no LANE.md yet |
| docs-reports | nate | — | not started — no LANE.md yet |

**Journeys:** 1 of 6 green (2026-09-11, after cases). 02 (inquiry → case) passes. 01 now reaches the
case screen and fails only on an ambiguous `getByText(/bills/i)` (matches nav link + the case's "Bills"
heading) — protected-path amendment: scope to `main` or use `getByRole('heading')`. 03–06 fail on screens
later lanes build (time, funds, bank import, dashboard). Progress reading, not a merge gate.

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
