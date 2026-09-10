# Technology Associates — Lane Progress

One row per lane in `MAP.md`. Written only during `/merge-lane`. Append-only
across rounds — never reset. Per-item detail lives in `progress/<lane>.md`.

## Round: full v1 → go-live

| Lane | Assignee | Branch | Status |
|------|----------|--------|--------|
| migration | nate | lane/migration | done — 4/4 items, merged 2026-09-09 (`a3add4b`) |
| app-shell | nate | lane/app-shell | done — 12/12 items (7 planned + 5 polish), merged 2026-09-10 (`464ab58`) |
| cases | nate | — | not started — no LANE.md yet |
| time | nate | — | not started — no LANE.md yet |
| billing | nate | — | not started — no LANE.md yet |
| money | nate | — | not started — no LANE.md yet |
| docs-reports | nate | — | not started — no LANE.md yet |

**Journeys:** 0 of 6 green (2026-09-10, after app-shell). Red by design until the lanes wire them.
02–06 now get past sign-in and fail on screens later lanes build (cases, time, funds, bank import,
dashboard). 01 (after the `login()` amendment below) reaches `/cases/90001` and fails on the missing
case screen (cases lane). This is a progress reading, not a merge gate.

**Amendments this round**

- 2026-09-09 — `supabase/migrations/0006_trial_load_fixes.sql` (PR #2, `2cab8db`).
  Three schema defects found by trial-loading the client's real `.bak`: 17 `bit`
  columns lose `not null`, three hours columns widen to `numeric(9,3)`, and phantom
  `tblcase.casestatusharddeadline` is dropped. `FOUNDATION.md`'s type map and
  `lib/db/types.ts` were amended to match. Any live lane must rebase onto
  `integration` before assuming the frozen shapes.
- 2026-09-10 — `tests/journeys/helpers.ts` (`966a523` on `main`). `login()` now awaits
  the redirect off /login; the next `page.goto` was aborting the sign-in POST.
