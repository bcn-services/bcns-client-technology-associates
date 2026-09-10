# Progress

Tracks where we are in `LANE.md`. LANE.md is the contract; this tracks where we
are in it — if they disagree, LANE.md wins for scope.

**Current position**

- **Status:** items 1–4 done — sign-in, sign-out, route gate, and the navigable shell all work
- **Next:** item 5 — admin users page (list + create)
- **Blockers:** none
- **Last updated:** 2026-09-09

| Item | Status |
|------|--------|
| Seed script (`tests/app-shell/seed-e2e.ts`) | done — the test account the automated login checks use now gets created automatically and safely, even if the script runs more than once. |
| `middleware.ts` — session refresh + route gate | done — every page except sign-in and the health check now sends signed-out visitors to the sign-in page, and it refuses entry if the login service is slow or down. Flagged for human review. |
| Login page + sign-out | done — staff can sign in and land where they were headed, a wrong password shows an error, and signing out logs them out. |
| App shell — layout, nav, home page | done — signed-in staff see a header with every section, their email and role, and a sign-out button; only admins see the Users link. |
| Admin users page — list + create | not started |
| Admin users page — role change, deactivate, billing-person link | not started |
| Account page — change own password | not started |
