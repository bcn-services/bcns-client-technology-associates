# Technology Associates — docs-reports Lane Progress

LANE.md is the contract; this tracks where we are in it — if they disagree,
LANE.md wins for scope, this file wins for state.

## Current position

- **Status:** item 1 of 6 done. Autonomous run in progress on `auto/docs-reports`, forked from `lane/docs-reports`.
- **Next:** item 2 — the month-matrix report engine.
- **Blockers:** none.
- **Last updated:** 2026-09-19

## docs-reports lane (2026-09-19)

| Item | Status |
|------|--------|
| Detail-list report engine | done — Kris can pull the rows behind the Monthly Expense and Monthly Income reports for any date range, narrowed by expense type, description, or branch, with a per-type summary that always agrees with the rows. Speed was proved against a stand-in database, not the practice's live one. (2026-09-19) |
| Month-matrix report engine | not started |
| P&L summary engine | not started |
| `/reports` page | not started |
| Excel export | not started |
| `/dashboard` | not started |
| Supabase Storage adapter | skipped — below stop marker |
| `/documents` and case documents panel | skipped — below stop marker |

## Notes for the human

- **Authentication is not yet wired on the report pages.** No query module in
  this codebase calls `requireSession()`; the house pattern puts it on the page
  (`Promise.all([requireSession(), <query>])`). Item 4 builds the first page in
  this lane and must wire it, or `/reports` ships readable without signing in.
- **The report tests do not run under `pnpm test`.** `package.json`'s `test`
  script names each directory explicitly and does not include
  `tests/docs-reports/`. Adding it is out of scope for this lane
  (`package.json` is unowned), so it needs an amendment or a follow-up item —
  otherwise these tests silently never run in CI.
- **Report speed is unmeasured against the real database.** The sub-2s
  criterion was met against an in-memory stand-in only. Seeding the 60,000 rows
  the criterion asks for would have written them into the practice's live
  Supabase project, so it was deliberately skipped; nothing was seeded anywhere.
