# lane/cases → integration

## Team-memory entries (append in merge order)

## 2026-09-11 18:37 — dev-team — lane/cases item 1: firms, attorneys, clients
- **Outcome:** DONE — 1 attempt — caution: no — team: dt-engineer opus/medium (via dt-orchestrator opus/medium) — item/contacts, 1cb272c
- **What happened:** Built list/create/edit screens for firms, attorneys and clients, the five legacy presets (ported from Access MSysQueries via mdbtools), and an idempotent hosted fixture seeder. The engineer self-verified; the orchestrator re-ran the gate and all 9 mutations (a, b1–b5, c×2, d), and all went red.
- **What worked:** Reading the legacy queries straight from the .accdb with mdbtools. A SQL-level preset test on a private local DB compares each preset with the legacy query translated to Postgres. A grep-based no-delete test. A perl-in-place mutation script with cp backup and cmp restore.
- **What failed:** Plain `pnpm test` goes red (58 failures) when parallel worktrees drop and recreate the shared `ta_foundation` DB mid-run. Nothing wrong with the code.
- **Remember next run:** Run `pnpm test` with `FOUNDATION_PG_URL` pointed at a private DB (createdb ta_<item>_gate) while other lanes or items run. The Access form layouts can't be read with mdbtools, so labels are unverified against legacy. Live contact tests leave "Contacts Live <tag>" rows in the hosted DB (no delete path). Presets join whole tables in JS (a ponytail comment marks it); move them to a view if tblcase grows past about 50k rows.
