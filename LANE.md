# Technology Associates — Lane: migration

## Objective

Every row of the client's live SQL Server database lands in Supabase unchanged, from an SSMS "Generate Scripts (data only)" export Kris produces in a few clicks, re-run once more on go-live day.

Lane done when:
- Loading Kris's export leaves every legacy table with exactly the row count present in the source file, printed as a passing report
- Loading the same export twice yields identical counts, zero duplicates, and identity sequences past max id
- No credential, `.bak`, or export file is tracked in git

Lane: migration — one-shot import of the SQL Server .bak into Supabase, re-runnable at go-live; rotates legacy credential first

Owned — this lane's items live inside these paths:
  scripts/migrate/**, tests/migration/**

Open — merged lanes. Wiring items may edit these; rebase onto `integration` first:
  (none — nothing has merged)

Stop and report if an item requires changing a path outside both lists:
  protected — supabase/migrations/**, lib/db/**, lib/auth/session.ts, lib/auth/client.ts, lib/env.ts, scripts/gen-db-types.mjs, tests/foundation/**, tests/journeys/**, playwright.config.ts, tsconfig.foundation.json
  an unmerged lane's — app/layout.tsx, app/page.tsx, app/globals.css, app/(auth)/**, lib/auth/**, tests/app-shell/**, app/cases/**, app/firms/**, app/attorneys/**, app/clients/**, app/inquiries/**, lib/cases/**, lib/contacts/**, lib/inquiries/**, tests/cases/**, app/time/**, lib/time/**, tests/time/**, app/bills/**, lib/bills/**, tests/billing/**, app/expenses/**, app/funds/**, app/bank-review/**, lib/expenses/**, lib/funds/**, lib/bank-import/**, tests/money/**, app/documents/**, app/reports/**, app/dashboard/**, lib/documents/**, lib/reports/**, lib/storage.ts, tests/docs-reports/**
  unowned — . (root config), .github/workflows, .claude/worktrees, app/api/health, lib/health.ts, lib/ai.ts, lib/webhooks.ts, tests/*.test.mjs

Frozen contracts — build and test against these; they will not move:
  supabase/migrations/0001..0005 (the 20 legacy tables + profiles/bank_transactions/audit_log) · lib/db/types.ts · tests/foundation/fixtures/rows.ts · tests/foundation/harness.mjs (resetDb / syncSequences — reuse, do not copy)

Test against the fixture, not the producing lane. Do not wait for it to exist.

## Status

Foundation merged 2026-09-08. No Supabase project yet; every item runs and is tested against the local brew Postgres the foundation harness builds (`FOUNDATION_PG_URL`, default `postgresql://localhost/ta_foundation`). The real Supabase run is done by hand from the runbook after this lane merges. Kris produces the export himself; no tables were added since the 2026-08-18 `.bak`.

## Global rules

- The 20 legacy tables are exactly: tblstates tblbranches tblcasestatus tblcasepriority tblcasewaitingfor tblbillingnames tblexptype tblfirm tblattorney tblclient tblinquiry tblcase tblbills tblactivity tblexpenses tblfundsrcvd tblsrvauth tblcaseresult tbl_scannedbillandcheck tblscanneddocument. Nothing in this lane writes to, truncates, or reads schema from any other table except `profiles` in item 4.
- Legacy data loads as-is. No cleanup, dedupe, trimming, or "fixing" of values — report, never alter. A value that does not fit its pinned column type is a schema amendment, not a coercion: fail naming `table.column`.
- Never commit an export file, a `.bak`, a credential, or `logins.json` with real emails. `scripts/migrate/in/` and `scripts/migrate/out/` are gitignored; tests use synthetic exports under `tests/migration/fixtures/`.
- Scripts take the database URL from the `MIGRATE_DB_URL` env var only, defaulting to the harness DB; no other `process.env` reads (CLAUDE.md: `lib/env.ts` is the app's only reader — these scripts are outside the app and take exactly one var).
- Scripts are plain `.mjs` run with `node`, using `psql` via `execFileSync` like the harness; no new runtime dependency unless an item says so.
- Context: `CLAUDE.md`, `LEGACY.md`, `FOUNDATION.md`, `MAP.md`.

## Not yet specified

- NAS Excel timesheets → `tblactivity` rows (unbilled hours per person; column contract `Date, Task, Dec, Sub, Fee($), Billed`) — at cutover those rows must exist or the time→bill journey starts from nothing. Revisit when Kris sends one sample workbook.

## Out of scope

- Scanned document archive off the network shares — docs-reports lane (MAP.md).
- Rotating the `TechAssoc` SQL Server password — human step on the client's server before cutover, listed in the runbook, no repo code.
- Creating the Supabase project and `MIGRATE_DB_URL` — human step (`~/os` memory `reference-bcns-ci-setup`).
- Any data cleanup or reconciliation of legacy inconsistencies — later lanes decide per feature; this lane only reports them.
- Restoring the `.bak` ourselves (SQL Server on a droplet) — fallback only if Kris's export fails twice; not planned.

---

- task: Runbook `scripts/migrate/README.md`. Part 1, for Kris: click-by-click SSMS "Generate Scripts" — right-click database → Tasks → Generate Scripts → select the 20 tables (list them) → Advanced → "Types of data to script: Data only", "Script for Server Version: SQL Server 2022", single file, Unicode → zip → send via the same route as `TA_Files`. Part 2, for Nate: cutover sequence — Kris freezes Access → export → `node scripts/migrate/load.mjs in/<file>.sql` → `node scripts/migrate/verify.mjs in/<file>.sql` → `node scripts/migrate/seed-logins.mjs in/logins.json` → hand over; plus the branch when verify fails (do not seed, do not hand over, send the report back). Part 3: the two human pre-steps (rotate `TechAssoc` password, create Supabase project + `MIGRATE_DB_URL`) and the go-live re-run being identical to the first run. Add `scripts/migrate/in/` and `scripts/migrate/out/` to `.gitignore` via a `scripts/migrate/.gitignore`.
  guardrails:
    - Kris's section assumes SSMS and nothing else — no PowerShell, no bcp, no module installs
    - Commands in the runbook are the exact invocations items 2–4 ship; update them if a later item changes a flag
  done when:
    - `scripts/migrate/README.md` exists with the three parts above and names all 20 tables in Kris's selection step
    - `scripts/migrate/.gitignore` ignores `in/` and `out/`; `git check-ignore scripts/migrate/in/x.sql` succeeds
    - Every `node scripts/migrate/*.mjs` invocation in the README matches a script file and flag set present on the branch
  status: not started

- task: `scripts/migrate/load.mjs <export.sql>` — load an SSMS data-only script into Postgres. Read the file as UTF-16 LE with BOM (SSMS default) falling back to UTF-8. Parse the machine-generated grammar: `USE`/`GO`/`SET IDENTITY_INSERT ... ON|OFF`/`SET ANSI_NULLS` lines dropped; `INSERT [dbo].[Tbl] ([Col], ...) VALUES (...)` (also the `INSERT ... VALUES (...), (...)` multi-row form SSMS emits in batches of 100) → table + column list lowercased, brackets stripped. Value translation per column type read once from `information_schema.columns` for the 20 tables: `N'…'`/`'…'` string literals with `''` escaping and embedded newlines kept verbatim; `NULL` → NULL; `CAST(N'yyyy-mm-ddThh:mm:ss.fff' AS DateTime)`/`AS Date`/`AS Time` → the ISO literal, cast by Postgres to the pinned `date`/`time`/`timestamptz`; `CAST(x AS Decimal(…))`/`AS Money` → numeric literal; integer `0`/`1` targeting a `boolean` column → `false`/`true`; a value that Postgres rejects surfaces as `table.column: <pg error>` and aborts. Table in the file but not one of the 20 → skipped, listed on stderr. Execution: one `psql` session, `set session_replication_role = replica` (so `NOT VALID` FKs and the `audit` triggers stay quiet), `truncate <20 tables> cascade`-free — truncate only the 20 by name, inserts in file order, then the `syncSequences` SQL from the harness (import it), print rows inserted per table. Whole run in one transaction: any failure → nothing changed.
  guardrails:
    - Truncates only the 20 legacy tables; `profiles`, `bank_transactions`, `audit_log` are never named in this script
    - No coercion beyond the listed translations — never trim, never default a NULL, never clamp a number
    - Replica mode is set for the session only; the script never alters constraints or triggers
  done when:
    - Loading `tests/migration/fixtures/export-small.sql` (synthetic, ≥3 rows per table across all 20 tables, one `ntext` value containing a newline, a `'`, and a `;`, one boolean 1 and one 0, one `DateTime` at `23:30:00`, one orphan `expcaseid`, one `NULL` in a nullable text column) into the harness DB yields the exact row counts per table, the `ntext` value round-trips byte-for-byte, the boolean pair reads `true`/`false`, the date column reads the file's calendar date under both `TZ=UTC` and `TZ=America/New_York`, and the NULL stays NULL (not `''`)
    - Loading the same fixture twice leaves identical counts, and `insert into tblcase (casetitle) values ('x')` afterwards receives an id greater than the fixture's max caseid
    - A fixture containing `INSERT [dbo].[tblActive] ...` and an out-of-range `smallint` value: the unknown table is listed on stderr and skipped; the bad value aborts with `tblbillingnames.personid` (or the relevant `table.column`) in the error and leaves every table empty
    - `audit_log` has zero rows after a load, and existing `pnpm test` stays green
  status: not started

- task: `scripts/migrate/verify.mjs <export.sql>` — fidelity report after a load. Re-parse the export with the parser from item 2 (export it from `load.mjs` or a shared `scripts/migrate/parse.mjs`) to get source row counts per table and per-table sums of every `numeric` column, then query the database for: row count per table, the same sums, max of the identity column, orphan count per `NOT VALID` FK (from `pg_constraint` where `convalidated = false`, counted with a `left join`), drift on the VBA-maintained denormalized columns (`tblcase.numunpaidbills` vs `count(tblbills where billpaiddate is null)` per case, `numunapprovedsa` vs `count(tblsrvauth where srvauthstatus <> 'Approved')` per case — report count of cases where they disagree), and max length of every `text` column that came from `ntext`. Print a Markdown table to stdout and write it to `scripts/migrate/out/verify-<timestamp>.md`. Exit 1 on any count or sum mismatch; orphans and drift are informational.
  guardrails:
    - Read-only against the database: no writes, no fixes, no `set session_replication_role`
    - Mismatch exit is on counts and sums only; orphans and denormalized drift never fail the run
  done when:
    - After loading `export-small.sql`, `verify.mjs` exits 0 and its report shows equal source/database counts for all 20 tables, the orphan `expcaseid` counted under its FK, and at least one line of denormalized drift the fixture deliberately plants
    - After deleting one `tblexpenses` row directly, `verify.mjs` exits 1 and the report marks the `tblexpenses` count and `expamount` sum as mismatched
    - The report file lands in `scripts/migrate/out/` and that path is ignored by git
  status: not started

- task: `scripts/migrate/seed-logins.mjs <logins.json>` — create the first Supabase auth users and their `profiles` rows. Input: array of `{ email, role: 'admin'|'staff', personid: number|null }`. For each: `supabase.auth.admin.createUser({ email, email_confirm: true })` via `createServerClient()` from `lib/db/client.ts` (service role); on "already registered" look the user up by email instead; then `upsert` into `profiles` on `id` with `email`, `role`, `personid`. `personid` must exist in `tblbillingnames` (query first; unknown → abort before any user is created). Print `email → role (created|existing)`. Ship `scripts/migrate/logins.example.json` with three invented entries; the real `in/logins.json` is gitignored by item 1. Because auth users need a real Supabase project, tests cover the pure parts: input validation, the personid check against the harness DB, and the upsert SQL shape via an injected fake admin client.
  guardrails:
    - Never sets a password — users get an invite/reset flow from the app; the script only creates the account and profile
    - Idempotent on email: a second run with the same file creates nothing and changes only `role`/`personid` if the file changed
    - Uses the frozen `Session`/`Role` contract's role values only (`admin`, `staff`); any other string aborts
  done when:
    - `logins.example.json` with three entries passes validation; a file with `role: 'owner'` or a `personid` absent from `tblbillingnames` aborts before any `createUser` call (fake client records zero calls)
    - With a fake admin client that reports the second email as already registered, the run ends with three `profiles` rows in the harness DB, two `created` and one `existing`, and a second run leaves the row count at three
    - `pnpm typecheck` passes with the script's imports from `lib/db/client.ts`
  status: not started

> **⚠️ AUTONOMOUS RUN — STOP HERE**
