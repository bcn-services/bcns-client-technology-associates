# Progress — cases lane

Tracks where we are in `LANE.md`. LANE.md is the contract; this tracks where we
are in it — if they disagree, LANE.md wins for scope.

**Current position**

- **Status:** 3 of 9 items done; case record and case presets in progress
- **Next:** new case, service authorizations, convert inquiry, app-shell wiring
- **Blockers:** hosted Supabase is missing migration 0007 (case search view) and has no fixture case — needs `supabase db push` by Nate before journey 02 / live case pages can pass
- **Last updated:** 2026-09-11

| Item | Status |
|------|--------|
| Firms, attorneys, and clients | done — Staff can list, add, and edit firms, attorneys, and clients, and open the five legacy contact lists; nothing can be deleted. |
| Inquiries | done — Staff can search inquiries (quick, advanced, and saved lists), log a new inquiry, and edit one; the quick-search fields and the how-heard/engineer suggestion lists are reconstructed and need confirming against the Access file. |
| Case search and lists | done — Staff can find a case by number, title, attorney, client, or firm, run the checkbox search with AND/OR, browse the three case lists, and print an address label; cases with a missing attorney or client still show up. Flagged for human review. |
| The case record | not started |
| Case presets | not started |
| New case | not started |
| Service authorizations on the case page | not started |
| Convert an inquiry to a case | not started |
| Wire cases into the app shell | not started |
