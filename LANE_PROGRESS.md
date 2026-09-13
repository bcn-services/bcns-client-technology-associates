# Technology Associates — Billing Lane Progress

LANE.md is the contract; this tracks where we are in it — if they disagree,
LANE.md wins for scope, this file wins for state.

## Current position

- **Status:** autonomous run in progress (dev-team-auto, 2026-09-12)
- **Next:** Revise
- **Blockers:** none
- **Last updated:** 2026-09-12

## Round: full v1 → go-live

| Item | Status |
|------|--------|
| Bill rules | done — The rules every billing screen shares (which statuses count as unpaid, the 1st → 2nd → Final sequence, bill file names, and when a bill is 30 days due) now exist and are tested. |
| Bill page with edit-in-place | done — Each bill now has its own page showing every field, its case, the time entries on it, and revision links; admins can edit the date, type, balance, estimate, comments, and file name, and staff can only look. |
| Create bill | done — Admins can create a bill on a case from its unbilled time: hours are totalled from the checked entries, those entries are marked billed, and if someone else billed an entry in the meantime nothing is saved and the admin is asked to reload. |
| Notice actions on /bills/[id] | done — Admins can move an unpaid bill from 1st to 2nd to Final notice, which stamps each notice date with today's New York date, or close it as Cancelled, Carried Over, Deadbeat or Settled; a repeated or out-of-date click changes nothing. |
| Revise | not started |
| /bills list | not started |
| Recipient alert | not started |
| Wire bills into the case page | not started |
| Wire bills into time screens | not started |
