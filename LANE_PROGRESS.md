# Progress — cases lane

Tracks where we are in `LANE.md`. LANE.md is the contract; this tracks where we
are in it — if they disagree, LANE.md wins for scope.

**Current position**

- **Status:** 6 of 9 items done; service authorizations in progress
- **Next:** new case, service authorizations, convert inquiry, app-shell wiring
- **Blockers:** hosted Supabase is missing migration 0007 (case search view) and has no fixture case — needs `supabase db push` by Nate before journey 02 / live case pages can pass
- **Last updated:** 2026-09-11

| Item | Status |
|------|--------|
| Firms, attorneys, and clients | done — Staff can list, add, and edit firms, attorneys, and clients, and open the five legacy contact lists; nothing can be deleted. |
| Inquiries | done — Staff can search inquiries (quick, advanced, and saved lists), log a new inquiry, and edit one; search fields and value lists match the Access file (how-heard has 15 values, not the 14 the plan says). |
| Case search and lists | done — Staff can find a case by number, title, attorney, client, or firm, run the checkbox search with AND/OR, browse the three case lists, and print an address label; cases with a missing attorney or client still show up. Flagged for human review. |
| The case record | done — Staff can open a case, unlock it, edit and save it (only changed fields are written, and a stale form can't undo someone else's edit), see the Unpaid Bill / Unapproved SA / fee-schedule badges, step to the previous or next case, and print a rolodex card. Flagged for human review. |
| Case presets | done — Staff can open the Work Status (two sort orders plus a print sheet), Waiting For (with funds received), Other experts, and Recent activity lists, each matching the legacy Access query. |
| New case | done — Staff can open a new case form prefilled with the next case number, TBD title, today's date and Open status, add an attorney or client without losing their place, and are told "Case number already exists" if someone else took the number first. |
| Service authorizations on the case page | not started |
| Convert an inquiry to a case | not started |
| Wire cases into the app shell | not started |
