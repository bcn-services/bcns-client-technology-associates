# Technology Associates — Time Lane Progress

LANE.md is the contract; this tracks where we are in it — if they disagree,
LANE.md wins for scope.

## Current position

- **Status:** autonomous run complete — all 6 items done, none blocked; lane acceptance review found all 4 "Lane done when" criteria met in code; PR into `integration` open
- **Next:** review and merge `lane/time` into `integration` (add `tests/time/*.test.mjs` to the `test` script at merge)
- **Blockers:** none in this lane. Journey 02 was already failing before this lane (header "Firms" link vs. case page "Firm" heading); journey 03 now reaches the bills page, which is the billing lane's work
- **Last updated:** 2026-09-12

## Round: time lane (v1)

| Item | Status |
|------|--------|
| Time entry form and insert | done — Staff can type an entry (case, date, hours, description) on the Time page and it saves under their name; bad input is refused with a message. |
| Week view + admin unbilled-by-case | done — The Time page now shows a Monday–Sunday week of entries with daily and weekly totals and previous/next links; admins can pick a person and see unbilled hours by case. |
| Edit and delete at /time/[id] | done — Staff can open their own unbilled entry to fix or delete it; billed entries and other people's entries can't be changed. |
| Start/stop timer on /time | done — Staff can start a timer on a case, stop it, and save the rounded time as an entry; it survives a page reload and can be discarded. |
| Time panel on the case page | done — Every case page now lists its time entries and shows its unbilled hours, with links to add an entry or start a timer. Journey 02 was already failing before this item (the header's "Firms" link and the case page's "Firm" heading both match its check); fixing it needs a change outside this lane. |
| Running-timer header indicator + E2E staff seed | done — While a timer runs, every page's header shows its case and elapsed time with a link back to the Time page; the test staff login is now linked to KJS, so the time-to-bill journey gets through time entry. |
