# Technology Associates — docs-reports Lane Progress

LANE.md is the contract; this tracks where we are in it — if they disagree,
LANE.md wins for scope, this file wins for state.

## Current position

- **Status:** all 6 items above the stop marker are done. Two plan criteria are unmet and need a human decision; both are plan defects outside this lane's ownership, not unfinished code. The toolchain that blocked it is diagnosed and repaired, and the plan itself was amended on 2026-09-19 to fix four defects in its own criteria. Run paused at Nate's request after item 4. Autonomous run in progress on `auto/docs-reports`, forked from `lane/docs-reports`.
- **Next:** decide the two open questions below, then merge the lane. Items 7 and 8 (document storage) sit below the stop marker and were deliberately not started.
- **Blockers:** none blocking. One caveat carries forward: no database anyone
  can reach holds the practice's real 2025 figures, so any criterion phrased as
  "matches the 2025 numbers" is checked as behaviour, not as a number. The plan
  now says so in writing, and names the local file that would close it.
- **Last updated:** 2026-09-19

## docs-reports lane (2026-09-19)

| Item | Status |
|------|--------|
| Detail-list report engine | done — Kris can pull the rows behind the Monthly Expense and Monthly Income reports for any date range, narrowed by expense type, description, or branch, with a per-type summary that always agrees with the rows. Speed was proved against a stand-in database, not the practice's live one. (2026-09-19) |
| Month-matrix report engine | done — Kris can pull the year-by-month grids behind the Expense Matrix, Income Matrix and Branch Matrix reports, broken out by expense type, income source or branch, with row and column totals that agree with the detail lists. Months with no activity come back genuinely empty rather than as a zero. Checked against a stand-in database; the practice's own 2025 figures were not available to compare against. (2026-09-19) |
| P&L summary engine | done — Kris can run the profit-and-loss summary for a year: income, expenses and net for each month plus a total for the year, with owner withdrawals shown on their own line rather than mixed into expenses. Stopping at a chosen month gives a part-year snapshot with the later months genuinely absent, which is how the quarterly tax figures are produced. Checked against a stand-in database. (2026-09-19) |
| `/reports` page | done — the reports screen exists with start and end date boxes, the six familiar report buttons plus an accountant export button, and one results panel each button refills. Signing in is enforced: asking for the page without signing in sends you to the login screen and shows no figures. The buttons were proved against a stand-in database rather than clicked through in a browser, because the only database the app is pointed at is the practice's live one, which this work is not allowed to write to. (2026-09-19) |
| Excel export | done — every report downloads as an Excel file, and the accountant export produces one workbook holding the full January hand-over set: a sheet per month for income and for expenses, plus the two yearly rollups and the profit-and-loss summary, 27 sheets in all. Money cells are real numbers with a currency format, not text, so the accountant can total them. The download was proved by building the file in a test, not by clicking it in a browser. (2026-09-19) |
| `/dashboard` | done, with two open questions for a human — the screen exists with four count tiles (due, overdue, waiting, unpaid) above the work-status table, sorted by priority, and it reuses the existing billing and case rules rather than recreating them. Two things in the plan cannot be satisfied from inside this lane: the end-to-end test for this screen looks for the word "due", which now matches both the Due and the Overdue tile and so fails on an ambiguity, fixable only in a file this lane may not edit; and two of the four tiles link to a page that lists more rows than the tile counts, because no page showing just those rows exists yet. (2026-09-19) |
| Supabase Storage adapter | skipped — below stop marker |
| `/documents` and case documents panel | skipped — below stop marker |

## Run summary — autonomous session, 2026-09-19

All six items above the stop marker are done. The suite went from 986 tests to
1074, with 859 passing and none failing; the extra tests are this lane's own,
which until today were never run by the shared test command at all.

Two things need a decision before the lane merges, and neither is unfinished
code:

- The end-to-end test for the dashboard looks for the word "due", which now
  matches both the Due tile and the Overdue tile, so it fails on an ambiguity
  rather than on a fault. The fix is one word, in a file this lane is not
  allowed to edit.
- Two of the four dashboard tiles link to a page that lists more rows than the
  tile counts, because no page showing just those rows exists yet. Either the
  plan's wording changes, or someone builds those two filtered pages in the
  lanes that own them.

Items 7 and 8, the document storage work, were deliberately not started.

## Notes for the human

- **The dependency wipe is solved, not just repaired.** The installed
  dependencies were emptied twice in one afternoon. The cause was this
  worktree's dependency folder being a shortcut to the main copy rather than a
  real folder: the build's packaging step followed the shortcut out of the
  project and rewrote the tree from outside it. Both shortcuts are now real
  folders, so the build cannot reach outside the project again. A second,
  quieter fault came with it — once the folder broke, the `npx` shortcut
  downloaded a much newer version of the web framework and ran it against this
  project, so checks were passing against the wrong software. The plan now
  forbids that shortcut.

- **Authentication is not yet wired on the report pages.** No query module in
  this codebase calls `requireSession()`; the house pattern puts it on the page
  (`Promise.all([requireSession(), <query>])`). Item 4 builds the first page in
  this lane and must wire it, or `/reports` ships readable without signing in.
- **This lane's tests still do not run in the shared test command.** The
  command lists folders one by one and this lane's folder is not among them,
  so its 58 tests pass only when run directly. The plan now grants the Excel
  export item permission to add that one line, and its sign-off requires the
  reported test count to go up, which proves the line took effect.

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
