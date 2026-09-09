# Technology Associates — Lane Progress

One row per lane in `MAP.md`. Written only during `/merge-lane`. Append-only
across rounds — never reset. Per-item detail lives in `progress/<lane>.md`.

## Round: full v1 → go-live

| Lane | Assignee | Branch | Status |
|------|----------|--------|--------|
| migration | nate | lane/migration | done — 4/4 items, merged 2026-09-09 (`a3add4b`) |
| app-shell | nate | lane/app-shell | not started — preconditions unmet (Tailwind 3.4 not installed; `middleware.ts` + `app/not-found.tsx` not in its `owns:`; no Supabase project) |
| cases | nate | — | not started — no LANE.md yet |
| time | nate | — | not started — no LANE.md yet |
| billing | nate | — | not started — no LANE.md yet |
| money | nate | — | not started — no LANE.md yet |
| docs-reports | nate | — | not started — no LANE.md yet |

**Journeys:** 0 of 6 green. Red by design until the lanes wire them — every spec
fails at `page.goto('/login')` with `ERR_CONNECTION_REFUSED`, because no app shell
exists yet. This is a progress reading, not a merge gate.

**Amendments this round**

- 2026-09-09 — `supabase/migrations/0006_trial_load_fixes.sql` (PR #2, `2cab8db`).
  Three schema defects found by trial-loading the client's real `.bak`: 17 `bit`
  columns lose `not null`, three hours columns widen to `numeric(9,3)`, and phantom
  `tblcase.casestatusharddeadline` is dropped. `FOUNDATION.md`'s type map and
  `lib/db/types.ts` were amended to match. Any live lane must rebase onto
  `integration` before assuming the frozen shapes.
