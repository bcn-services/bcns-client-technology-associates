# Progress

Tracks where we are in `LANE.md`. LANE.md is the contract; this tracks where we
are in it — if they disagree, LANE.md wins for scope.

**Current position**

- **Status:** parallel-group a done — seed script and route gate both finished
- **Next:** item 3 — login page + sign-out
- **Blockers:** none
- **Last updated:** 2026-09-09

| Item | Status |
|------|--------|
| Seed script (`tests/app-shell/seed-e2e.ts`) | done — the test account the automated login checks use now gets created automatically and safely, even if the script runs more than once. |
| `middleware.ts` — session refresh + route gate | done — every page except sign-in and the health check now sends signed-out visitors to the sign-in page, and it refuses entry if the login service is slow or down. Flagged for human review. |
| Login page + sign-out | not started |
| App shell — layout, nav, home page | not started |
| Admin users page — list + create | not started |
| Admin users page — role change, deactivate, billing-person link | not started |
| Account page — change own password | not started |
