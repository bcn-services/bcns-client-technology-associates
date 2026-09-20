# Technology Associates — docs-reports Lane Progress

LANE.md is the contract; this tracks where we are in it — if they disagree,
LANE.md wins for scope, this file wins for state.

## Current position

- **Status:** all eight items are done. The lane is ready to merge. Journey 06 — the
  lane's headline acceptance test — passes for the first time. The full test suite is
  green in both modes. One of the four "lane done when" criteria stays open by design:
  nobody has loaded the practice's real 2025 data anywhere, so no figure can be compared
  against the old Access reports yet.
- **Next:** a human reads the pull request into `integration`. Four things want a decision
  before or shortly after that merge — they are listed under "What still needs a person"
  below.
- **Blockers:** none. The two questions that paused the run after item 6 were settled by
  amending the plan, and the toolchain fault that stopped items 7 and 8 is fixed.
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
| Supabase Storage adapter | done — the app can now put a file into private storage and hand back a link that works for fifteen minutes and then stops working. Nothing is ever served from a public address, and a file's address is built from the case number plus a random token, never from the name the file was uploaded under. Proved against a throwaway copy of the database running on this machine, so the practice's own system was never touched. (2026-09-19) |
| `/documents` and case documents panel | done — a file can be attached to a case, it shows up on that case's page, and clicking it downloads the original unchanged. A case only ever shows its own documents: asking for another case's document by its number returns nothing at all. Signing in is required to upload and to download. Proved end to end against the throwaway database using two real cases. (2026-09-19) |

## Run summary — completion session, 2026-09-19

Items 7 and 8, the document storage work that was deliberately left out of the first
session, are now built and merged. Journey 06 passes.

The test suite finishes with **1106 tests and no failures**, in both of the two ways it
can be run: 878 pass with 228 skipped on a plain checkout, and 892 pass with 214 skipped
when the throwaway local database is switched on. It was 986 tests when this lane started.
The type checker is clean.

To prove the document work without touching the practice's live system, a complete copy of
the database now runs on this machine inside Docker. Standing it up took two fixes that are
worth knowing about, both captured in one re-runnable script
(`tests/docs-reports/local-stack-setup.sh`): the local copy grants the app no permission to
read or write any table until it is told to, and the sample data has to be loaded in a
specific order or it is rejected. The same script also creates the private storage area.

Journeys 02, 03, 04 and 05 still fail. They were re-run from a separate copy of the code
that contains none of this lane's work, and they fail there too, so this lane did not break
them. The reason is in the tests themselves, not in the app: they insert the rows they need
into the practice's hosted database while the screen they then check is reading a different
database, so the rows are never visible. That is the same on every branch.

A final review was run against the whole merged change. It confirmed three of the four
acceptance criteria by reproducing them itself, confirmed that the change touches only the
files this lane is allowed to touch, and confirmed that no real client figure appears in any
committed file. It found no critical fault and four things worth fixing, none of which stops
the merge. They are written up in the pull request.

## What still needs a person

- **Nobody has loaded the practice's real 2025 data.** Until someone restores the legacy
  backup into a throwaway database, no report figure can be checked against the old Access
  output. Every such criterion was checked as behaviour instead. A related gap: the plan
  promised that once that data exists the tests would read expected figures from a local
  file and skip when it is absent. The file is listed as ignored by version control, but
  nothing actually reads it yet, so dropping the file in place today would change nothing
  and could be mistaken for proof.
- **Four of the end-to-end journeys write to the practice's live database.** Journeys 03, 04
  and 05 are written that way on purpose and have been since before this lane; they add rows
  and then remove them again. Running them tonight therefore wrote to the live system. The
  check for whether anything was left behind could not be completed from here, because
  reading the live database is blocked. Somebody should confirm case 90001 is clean, and
  decide whether those tests should keep working that way at all.
- **"Authorized user" currently means anyone who is signed in.** Every signed-in person can
  see every document in the practice from the `/documents` screen. That matches how bills
  and funds already work, but for legal case files it should be an explicit decision rather
  than an inherited one.
- **Two report buttons ignore the end date.** P&L and the accountant export always produce a
  full calendar year, even when a narrower range is entered. The underlying engine already
  supports stopping at a chosen month — that is how the quarterly tax snapshots are made —
  but no button on the screen uses it yet.

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

- **A second way the dependencies get wiped, still open.** This one is not in
  the project — it is on Nate's machine. Two different versions of the package
  installer are reachable, 9 and 11. The project file asks for 11, but the one
  the shell finds first is 9. The main copy of the project was last installed
  by 9, so when version 11 ran, it judged the folder stale and tried to delete
  and rebuild the whole thing. It stopped only because nothing was there to
  answer its yes-or-no question. Run by hand in a terminal, that question does
  get asked, and one careless yes wipes the folder. The main copy has now been
  reinstalled with version 11 so both agree, but the shell still finds 9 first.
  Choosing which one wins is a change to Nate's machine, outside this project,
  so it is left for him.

- **The first dependency wipe is solved, not just repaired.** The installed
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
