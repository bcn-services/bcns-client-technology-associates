# Technology Associates — Lane Map

Round: full v1 → go-live. Solo (nate), lanes run one at a time in listed order.
Amended 2026-09-21: bill output is IN. The legacy database generates every bill
(Word template → PDF → Thunderbird email); the 2026-09-08 "client bills from another
service" note was wrong. Real rate card stays deferred — guessed defaults, admins set the
rate per person at finalize. One branch only (Stratford). Legacy table/column names carry
into Postgres unchanged.

protected:
  - supabase/migrations/**        # schema = LEGACY.md tables + profiles/bank_transactions/audit_log, frozen by /foundation
  - lib/db/**                     # generated row types + service-role client (FOUNDATION.md items 6)
  - lib/auth/session.ts           # Session/Role contract (item 7)
  - lib/auth/client.ts            # cookie-bound user client (item 7)
  - lib/env.ts                    # lazy config seam (CLAUDE.md contract)
  - scripts/gen-db-types.mjs      # types generator; `pnpm db:types` after any migration
  - tests/foundation/**           # fixtures + contract tests, must stay in sync with the shapes
  - tests/journeys/**             # journey suite, ships red
  - playwright.config.ts          # journey target config
  - tsconfig.foundation.json      # typecheck:foundation

unowned:
  - . (root config: package.json, pnpm-*.yaml, tsconfig, next/eslint config, *.md) — repo config, Reviewer edits on main
  - .github/workflows — template CI/deploy, not round work
  - .claude/worktrees — dev-team scratch
  - app/api/health, lib/health.ts — template health check, unchanged
  - lib/ai.ts, lib/webhooks.ts — AI off, no webhooks (CLIENT.md)
  - tests/*.test.mjs (ai-optin, qa-hosted-web, rls-forbidden-read) — template scaffold tests
  - remote sync + backup (Kalpna task 5) — obsolete under hosting

journeys:
  - Legacy .bak loaded into Supabase → an existing case shows its full bill, funds, and expense history unchanged
  - Receptionist logs an inquiry → engineer converts it to a case with firm, attorney, and client attached
  - Jon and Kris each enter time on a case → a timesheet bill record is created from their merged unbilled hours, balance entered, both activity rows marked billed, balance visible on the case
  - Check scanned → funds recorded against the bill → bill marked paid → case unpaid count drops, second/final notice dates stay empty
  - Bank of America card export uploaded → transaction reviewed, expense type assigned (retired types hidden, never deleted) → shows on the case ledger and clears against the bank account
  - Partner opens dashboard → sees due/overdue/waiting/unpaid by priority → runs P&L, YearlyExpense, and accountant export for a date range
  - Admin finalizes a timesheet bill with one person's rate changed → previews the PDF and the email → sends → PDF stored on the case, the charged rates saved on the bill (added 2026-09-21)

---

- lane: migration
  area: one-shot import of the SQL Server .bak into Supabase, re-runnable at go-live; rotates legacy credential first. Amended 2026-09-12: also imports the NAS Excel timesheet history (per-person workbooks, one sheet per case) into tblactivity — gated on Kris's workbook samples and on whether the migrated tblactivity rows are real
  owns: [ scripts/migrate/**, tests/migration/** ]
  assignee: nate
  depends on: — (schema frozen in supabase/migrations by /foundation; runs first)

- lane: app-shell
  area: auth, admin/staff roles, layout, nav, home page
  owns: [ app/layout.tsx, app/page.tsx, app/globals.css, app/not-found.tsx, middleware.ts, app/(auth)/**, lib/auth/**, tests/app-shell/** ]
  assignee: nate
  depends on: —

- lane: cases
  area: cases, firms, attorneys, clients, inquiries, service authorizations, case search
  owns: [ app/cases/**, app/firms/**, app/attorneys/**, app/clients/**, app/inquiries/**, lib/cases/**, lib/contacts/**, lib/inquiries/**, tests/cases/** ]
  assignee: nate
  depends on: app-shell (session + role helper — contract lib/auth/session.ts)

- lane: time
  area: in-app time entry per person per case (replaces the NAS Excel timesheets); unbilled hours per case. Rate card deferred — bills are priced in the client's other service
  owns: [ app/time/**, lib/time/**, tests/time/** ]
  assignee: nate
  depends on: cases (tblcase rows — contract lib/db types), app-shell (session — contract lib/auth/session.ts)

- lane: billing
  area: bill records tagged with one of 6 types, hours pulled from unbilled activity rows (merged multi-person), balance entered from the client's billing service, notice sequence dates, threshold alert, revisions as versions — no PDF, no email, no rate math
  owns: [ app/bills/**, lib/bills/**, tests/billing/** ]
  assignee: nate
  depends on: time (unbilled tblactivity rows — contract lib/db types), cases (tblcase rows — contract lib/db types)

- lane: money
  area: expense ledger with soft-retired types, funds received against bills, bank/card export review inbox, cleared-flag + bank-account views, bounced-check reversal
  owns: [ app/expenses/**, app/funds/**, app/bank-review/**, lib/expenses/**, lib/funds/**, lib/bank-import/**, tests/money/** ]
  assignee: nate
  depends on: billing (tblbills rows — contract lib/db types), cases (tblcase rows — contract lib/db types)

- lane: docs-reports
  area: case documents on Supabase Storage + archive migration, work-status dashboard, P&L / YearlyExpense / accountant export, discovery-confirmed report set
  owns: [ app/documents/**, app/reports/**, app/dashboard/**, lib/documents/**, lib/reports/**, lib/storage.ts, tests/docs-reports/** ]
  assignee: nate
  depends on: cases, time, billing, money (read-only over their tables — contract lib/db types)

- lane: billing-output
  area: added 2026-09-21. Bill PDFs for all 6 types from the legacy invoice layout, per-person rate set at finalize (admins only, stored per bill line), Preview-then-Send email via Resend with the legacy To/CC/subject/body, 2nd/Final notice resend with stamp, service authorization document + legacy approval-date rule
  owns: [ app/bills/**, lib/bills/**, lib/bill-docs/**, app/cases/[id]/service-auths.tsx, app/cases/[id]/sa-submit.tsx, app/cases/service-auths/**, lib/cases/service-auths.ts, tests/billing-output/** ]   # app/bills + lib/bills taken over from billing (done); SA files from cases (done)
  assignee: nate
  depends on: billing (sequenced — merged), cases (sequenced — merged); protected-path amendments: supabase/migrations/0009 (bill lines), lib/env.ts (Resend keys + bill CC/BCC addresses), lib/db/types.ts regen

- lane: case-docs
  area: added 2026-09-21. The 4 prefilled case documents from frmCaseUpdate (Inspection Plan, Memo, CTA Report, File Review Summary) as downloads. Gated on Kris sending the .dotx templates; no LANE.md until then
  owns: [ lib/case-docs/**, app/cases/[id]/documents/**, tests/case-docs/** ]
  assignee: nate
  depends on: cases (tblcase / tblattorney / tblfirm rows — contract lib/db types)

- lane: parity
  area: added 2026-09-21. Every legacy form/query/report PARITY.md marks MISSING or PARTIAL and not owned by billing-output or case-docs, plus the accuracy harness (legacy query logic on the restored SQL Server vs the app's engines, month by month, zero diffs). LANE.md written from PARITY.md; each item names the done-lane path it takes over
  owns: [ scripts/parity/**, tests/parity/** ]   # + per-item takeovers of done-lane paths, listed in its LANE.md
  assignee: nate
  depends on: billing-output (sequenced — starts after billing-output merges; shares bill and SA files)
