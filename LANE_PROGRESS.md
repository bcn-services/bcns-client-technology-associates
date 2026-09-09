# Progress — lane: migration

Tracks where we are in `LANE.md`. LANE.md is the contract; this tracks where we
are in it — if they disagree, LANE.md wins for scope.

**Current position**

- **Status:** run complete 2026-09-09, autonomous — 4 of 4 items done, 0 blocked; two acceptance rounds run and both findings fixed
- **Next:** none — all four items done; lane ready for review and merge
- **Blockers:** none
- **Last updated:** 2026-09-09

| Item | Status |
|------|--------|
| Migration runbook (`scripts/migrate/README.md`) | done — written the step-by-step guide for restoring the client's database backup and running the import on cutover day |
| Export loader (`scripts/migrate/load.mjs`) | done — the importer reads the exported database file and loads every legacy table into the new database in one all-or-nothing pass |
| Fidelity verifier (`scripts/migrate/verify.mjs`) | done — after an import it checks every table against the row counts taken from the client's own SQL Server database, plus totals, sign-in id positions and file coverage, and fails loudly if anything does not match |
| Login seeder (`scripts/migrate/seed-logins.mjs`) | done — creates the first sign-in accounts for the office staff and links each to their person record; it never sets a password (people set their own via the invite email), refuses an unknown role or an unknown person, and can be safely re-run |
