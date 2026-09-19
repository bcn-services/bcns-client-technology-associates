# Technology Associates — docs-reports Lane Progress

LANE.md is the contract; this tracks where we are in it — if they disagree,
LANE.md wins for scope, this file wins for state.

## Current position

- **Status:** items 1-3 of 6 done; item 4 built but blocked. Run paused at Nate's request after item 4. Autonomous run in progress on `auto/docs-reports`, forked from `lane/docs-reports`.
- **Next:** restore the toolchain (see Blockers), then re-check item 4's behaviour before starting item 5 — the Excel export.
- **Blockers:** the project's installed dependencies (`node_modules`) were wiped
  mid-session and are still gone, so nothing in the repo can run — no tests, no
  build, no preview. One command restores it and no versions change, but it
  needs a human to run it; see the note at the bottom. One caveat carried forward: no database anyone can reach holds the practice's real 2025 figures, so any criterion phrased as "matches the 2025 numbers" is checked as behaviour, not as a number.
- **Last updated:** 2026-09-19

## docs-reports lane (2026-09-19)

| Item | Status |
|------|--------|
| Detail-list report engine | done — Kris can pull the rows behind the Monthly Expense and Monthly Income reports for any date range, narrowed by expense type, description, or branch, with a per-type summary that always agrees with the rows. Speed was proved against a stand-in database, not the practice's live one. (2026-09-19) |
| Month-matrix report engine | done — Kris can pull the year-by-month grids behind the Expense Matrix, Income Matrix and Branch Matrix reports, broken out by expense type, income source or branch, with row and column totals that agree with the detail lists. Months with no activity come back genuinely empty rather than as a zero. Checked against a stand-in database; the practice's own 2025 figures were not available to compare against. (2026-09-19) |
| P&L summary engine | done — Kris can run the profit-and-loss summary for a year: income, expenses and net for each month plus a total for the year, with owner withdrawals shown on their own line rather than mixed into expenses. Stopping at a chosen month gives a part-year snapshot with the later months genuinely absent, which is how the quarterly tax figures are produced. Checked against a stand-in database. (2026-09-19) |
| `/reports` page | built, not signed off — the reports screen exists with start and end date boxes, the six familiar report buttons plus an accountant export button, and one results panel each button refills. It passes every check that can be run without a working toolchain. It has not been clicked through in a real browser or checked against journey 06, because the toolchain disappeared partway through. (2026-09-19) |
| Excel export | not started |
| `/dashboard` | not started |
| Supabase Storage adapter | skipped — below stop marker |
| `/documents` and case documents panel | skipped — below stop marker |

## Notes for the human

- **The toolchain needs one command before anything else can proceed.** The
  installed dependencies were emptied twice this afternoon with no install
  running, which is not something any of this session's work did. Until it is
  restored, every remaining item is dead in the water. Restoring it changes no
  versions.

- **Authentication is not yet wired on the report pages.** No query module in
  this codebase calls `requireSession()`; the house pattern puts it on the page
  (`Promise.all([requireSession(), <query>])`). Item 4 builds the first page in
  this lane and must wire it, or `/reports` ships readable without signing in.
- **The report tests do not run under `pnpm test`.** `package.json`'s `test`
  script names each directory explicitly and does not include
  `tests/docs-reports/`. Adding it is out of scope for this lane
  (`package.json` is unowned), so it needs an amendment or a follow-up item —
  otherwise these tests silently never run in CI.
- **Nothing reachable holds the practice's real data.** The hosted database has
  a handful of smoke-test rows only; the legacy `.bak` has not been loaded
  anywhere. Every criterion in the plan that names a specific 2025 figure is
  therefore unverified — the engines were checked for correct behaviour on
  stand-in data instead. Loading the `.bak` into a scratch database is what
  would close this, and it needs a human decision.

- **One accounting question needs the practice's real data to settle.** The
  P&L treats an owner withdrawal as a separate line that is never subtracted
  from expenses. That is correct if a withdrawal is recorded only in its own
  column. If the old system also records it as an ordinary expense, expenses
  are overstated and the totals will not match the Access reports. Nobody can
  tell which without the legacy data.

- **Report speed is unmeasured against the real database.** The sub-2s
  criterion was met against an in-memory stand-in only. Seeding the 60,000 rows
  the criterion asks for would have written them into the practice's live
  Supabase project, so it was deliberately skipped; nothing was seeded anywhere.
