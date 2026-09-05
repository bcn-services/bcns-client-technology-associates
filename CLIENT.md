# CLIENT.md — Technology Associates

- **Slug**: `technology-associates`
- **Repo**: `bcn-services/bcns-client-technology-associates`
- **Business brief**: Technology Associates (Stratford, CT — Kristopher J.
  Seluga) runs its entire practice — cases, time, billing, expenses, income —
  on a ~20-year-old Access front-end over SQL Server Express, on one office
  server reachable only via VPN. Billing reads from per-person Excel
  timesheets on a NAS share, not from the database; rates are hardcoded in
  VBA; card/bank activity is reconciled by hand in a spreadsheet; bills go out
  through Word + Thunderbird. We are replacing this with one hosted web app
  covering the full workflow (inquiry → case → time → bill → payment), with
  the existing table/column structure and case history preserved. One project,
  one go-live — not staged partial releases. Full scope: quoted proposal at
  `~/os/clients/technology-associates/quote/2026-08-19-technology-associates.md`.
  Full legacy schema + business-logic reverse-engineering: `LEGACY.md`.
  **Contract status: quote drafted 2026-08-19, not yet signed (pricing blanks
  unfilled).**

## Scope, in the order it should be built/mapped

Mirrors the quote's dependency order (billing needs time entry, time entry
needs cases) — use this as the lane split for `/map`:

1. **Cases & contacts** — `tblCase`, `tblFirm`, `tblAttorney`, `tblClient`,
   `tblInquiry`, `tblSrvAuth` (service authorizations).
2. **Time & rates** — replaces the NAS Excel timesheets with in-app time
   entry; a managed rate card with effective dates (rates today are
   hardcoded in VBA and escalate at 2 years — needs current + historical rate
   cards from the client).
3. **Billing** — all 6 bill types (blank, timesheet, depoprep, depo, trial,
   retainer), PDF generation, email delivery (replaces Word + Thunderbird),
   notice sequence (first/second/final), bill revisions/versions.
4. **Money in/out** — full expense ledger (`tblExpenses`, `tblExpType` with
   soft-retired "DO NOT USE" types that must never hard-delete),
   `tblFundsRcvd`, bank/card review inbox (file-export import, not a live
   connection), bounced-check reversal.
5. **Documents, dashboard, reporting** — case documents (migrate the existing
   scanned archive off the office network shares), work-status dashboard,
   report set (confirmed with client during discovery), accountant export.

**Explicitly out of scope for this build**: payroll/tax filing, formal
double-entry statements, a live bank connection (file export only), an AI
phase (drafting bill narratives, auto-categorizing transactions, filing scans
by case — quoted separately, after go-live, once real usage shows where time
goes).

## Config decisions

| Decision | Status |
| --- | --- |
| Storage backend | **Supabase Storage (platform default)**. Case documents (scanned checks, bills, reports, fee schedules) get attached to cases and the existing scanned archive on the office network shares migrates in — no client-specific storage requirement (e.g. WebDAV) surfaced in the quote or legacy docs. |
| AI feature | **Off for this build.** The quote explicitly scopes AI assistance (transaction categorization, bill-narrative drafting, inquiry logging, document filing) as a separate, unpriced phase after go-live. Ship v1 with `AI_ENABLED` off; revisit once usage data shows where time actually goes. |
| Webhook providers | **None.** No live payment/bank connection in scope (bank/card activity arrives by file export and is reviewed/approved by a person); bill delivery is outbound email (Resend), not an inbound webhook integration. |

## Open questions (block precise scoping, not the map)

From the quote's "what we need from you" list and LEGACY.md's unresolved
items — needed before/during discovery, not before running `/map`:

- Current + historical billing rate cards, and how/when rates change (rates
  today live in VBA, versioned by year, escalating at the 2-year mark).
- Whether `tblActivity` (ActDate/ActHrs/ActWho/ActBilled) is used at all, or
  billing is 100% driven by the NAS Excel timesheets (confirm with Kris).
- Per-person Excel timesheet workbook samples (column contract:
  `Date, Task, Dec, Sub, Fee($), Billed`).
- One example of each of the 6 bill types, as currently sent to attorneys.
- 12 months of bank/card exports, for transaction-categorization accuracy.
- Which existing reports are actually used, and by whom.
- Approximate size of the scanned document archive, for migration/storage
  sizing.
- What the firm's accountant receives at year end.
- Staff list + per-person access (what each role can see/do).
- One named point of contact for the build.
- **Security**: `BackupLocal.bat`/`BackupRemote.bat` in the client's supplied
  files contain a plaintext SQL Server password, transferred through the same
  S3 bucket as the rest of the docs. Rotate this credential before migration
  work touches the live system.

## Source materials (not committed to this repo)

Client-supplied files (Access `.accdb`, SQL Server `.bak`, ODBC DSNs, backup
scripts) live in `~/Downloads/TA_Files/` — large binaries and one file
containing the plaintext credential above, so they stay out of git. Already
reverse-engineered into `LEGACY.md` in this repo.
