# Technology Associates — Money Lane

## Objective

Kris records every dollar in and out of the firm in the app instead of Access +
the BoA spreadsheet macro — firm-wide and case expenses under live (non-retired)
types, checks received against bills that mark them paid, card/bank exports
reviewed into the ledger, bounced checks reversed in one action — so each case's
ledger and each bank account's cleared view are right without the spreadsheet.

Lane done when:
- Journeys 04 and 05 pass end to end on the merged branch (after the journey
  amendment below)
- Recording funds that cover a bill's balance marks it paid, drops the case's
  live unpaid count, and leaves 2nd/Final notice dates empty
- Importing the same BoA export twice adds no new `bank_transactions` or
  `tblexpenses` rows
- Reversing a bounced check returns its bill to unpaid and both the original and
  the reversal row remain on record

## Status

Branch `lane/money` off `integration` (`685d0d3`). Migration, app-shell, cases,
time, and billing are merged. Nav already lists `/expenses`, `/funds`,
`/bank-review` (`lib/auth/sections.ts`); the case page holds
`<Slot title="Funds received" />` and `<Slot title="Expenses" />`
(`app/cases/[id]/page.tsx:196-197`). `lib/bills/notice.ts` deliberately never
writes `Paid` / `Partial Payment` / `billpaiddate` — this lane does.
`tblfundsrcvd` has no bill column (case only). Nothing under `app/expenses`,
`app/funds`, `app/bank-review`, `lib/expenses`, `lib/funds`, `lib/bank-import`,
or `tests/money` exists. The hosted DB holds only foundation fixture rows.

Lane: money — expense ledger with soft-retired types, funds received against bills, bank/card export review inbox, cleared-flag + bank-account views, bounced-check reversal

Owned — this lane's items live inside these paths:
  app/expenses/**, app/funds/**, app/bank-review/**, lib/expenses/**, lib/funds/**, lib/bank-import/**, tests/money/**

Open — merged lanes. Wiring items may edit these; rebase onto `integration` first:
  migration: scripts/migrate/**, tests/migration/**
  app-shell: app/layout.tsx, app/page.tsx, app/globals.css, app/not-found.tsx, middleware.ts, app/(auth)/**, lib/auth/**, tests/app-shell/**
  cases: app/cases/**, app/firms/**, app/attorneys/**, app/clients/**, app/inquiries/**, lib/cases/**, lib/contacts/**, lib/inquiries/**, tests/cases/**
  time: app/time/**, lib/time/**, tests/time/**
  billing: app/bills/**, lib/bills/**, tests/billing/**

Stop and report if an item requires changing a path outside both lists:
  protected — supabase/migrations/**, lib/db/**, lib/auth/session.ts, lib/auth/client.ts, lib/env.ts, scripts/gen-db-types.mjs, tests/foundation/**, tests/journeys/**, playwright.config.ts, tsconfig.foundation.json
  an unmerged lane's — docs-reports: app/documents/**, app/reports/**, app/dashboard/**, lib/documents/**, lib/reports/**, lib/storage.ts, tests/docs-reports/**
  unowned — root config (package.json, pnpm-*.yaml, tsconfig, next/eslint/tailwind/postcss config, *.md), .github/workflows, .claude/worktrees, app/api/health, lib/health.ts, lib/ai.ts, lib/webhooks.ts, tests/*.test.mjs

Frozen contracts — build and test against these; they will not move:
  billing (tblbills rows) — `lib/db/types.ts` `tblbills` Row (`billnotice`, `billpaiddate`, `billsecondnoticedate`, `billfinalnoticedate`, `billbalance`); open set + `isOpen` in `lib/bills/rules.ts`; fixture billid 1 on 90001 (notice `First` — not open under the legacy spelling)
  cases (tblcase rows) — `lib/db/types.ts` `tblcase` Row; fixture case 90001 in `tests/foundation/fixtures/rows.ts`
  schema (money tables) — `lib/db/types.ts` `tblexpenses`, `tblexptype`, `tblfundsrcvd`, `bank_transactions` Rows; `tblfundsrcvd.fndsbillid` nullable FK → `tblbills.billid` (migration 0008, amendment applied 2026-09-15); `bank_transactions` unique (bankaccount, postedon, amount, description) (migration 0004); BoA fixture `tests/journeys/fixtures/boa-export.csv` (`Date,Description,Amount`, negative = outflow)

Test against the fixture, not the producing lane. Do not wait for it to exist.

## Global rules

- Server-action pattern from `app/time/actions.ts`: `"use server"`, `requireSession(...)`, parse FormData, a `lib/<domain>` function taking `Db` that throws a typed error with `.code`, errors back via `?error=<code>`, `revalidatePath` + `redirect` on success. Pages are server components.
- Staff may create and edit expenses and funds and work the review inbox. Admin only (`requireSession('admin')`, `ForbiddenError` → `?error=forbidden`): mark paid, partial payment, bounced-check reversal, expense-type add/retire. Admin-only controls are not rendered for staff.
- Never hard-delete a `tblexpenses`, `tblfundsrcvd`, or `tblexptype` row, and ship no delete UI. Corrections are edits (the `audit_log` trigger records them); a bounced check is a reversal.
- `billnotice` strings use the legacy spelling exactly; the open set is imported from `lib/bills/rules.ts`, never redefined. Marking paid never touches `billsecondnoticedate` / `billfinalnoticedate`. Never write `tblcase.numunpaidbills`.
- Money is parsed and compared as fixed 2-decimal values (integer cents or decimal strings), never float arithmetic.
- No transactions over PostgREST: a multi-row write guards its `update` with the expected current values in the filter, checks the returned row count, and compensates on mismatch — the `guardedUpdate` pattern in `lib/bills/notice.ts`. The guard lives in the write statement, never only in a prior select.
- Dates are firm-local via `firmToday()` from `lib/cases/presets.ts`; `today` is injected into lib functions, never `new Date()` inline; dates are `yyyy-mm-dd` strings.
- Branch defaults to `Stratford` on every money form (`fndsbranch`, `expbranch`).
- Only `tblexptype.active = true` types are offered anywhere; legacy `null` counts as retired.
- No migrations, no schema or type changes, no new npm dependency.
- Unit tests `tests/money/*.test.mjs` use the fake PostgREST proxy pattern from `tests/cases/create.test.mjs`. Browser/live checks `tests/money/*.live.test.mjs` follow `tests/time/*.live.test.mjs`: skip cleanly without a dev server or `SUPABASE_SERVICE_ROLE_KEY`, invented case numbers 990900+, every inserted row removed in `after()` with the service role. Fixtures use invented data only.
- Existing passing tests remain passing, including the cases, time, and billing suites.
- Copy `.env.local` into each worktree before running live tests.
- At merge the Reviewer adds `tests/money/*.test.mjs` to the `test` script in `package.json` (unowned), as the time and billing merges did.
- Fuller context: `CLAUDE.md`, `MAP.md`, `LEGACY.md` (tblExpenses / tblExpType / tblFundsRcvd), `CLIENT.md`, quote §Money in/out.

## Amendment requests (outside this lane — human approves)

All three approved by Nate and applied by the Reviewer on 2026-09-15: journeys 04/05 rewritten as below (05 also clicks Import and scopes its selectors to the filing-fee review row), migration 0008 pushed to the hosted project, `lib/db/types.ts` regenerated.

- `tests/journeys/04-funds-to-paid.spec.ts` (protected) — create its own open `1st` bill on case 90001 in `beforeAll` and remove it in `afterAll`, as journey 03 does. The fixture bill's `First` notice isn't open, so the case starts at 0 unpaid and there is nothing to mark paid; a seeded bill would stay Paid after one run.
- `tests/journeys/05-bank-import-to-ledger.spec.ts` (protected) — create an active "Filing Fee" type and a retired type in `beforeAll`; remove its `bank_transactions` and `tblexpenses` rows in `afterAll`. Dedupe means a rerun otherwise finds no transaction to review.
- Funds → bill link (added 2026-09-14 at Nate's request: Kris wants to know which check paid which bill). The human applies the migration and regenerates types; then item "Link a check to the bill it paid" runs. Protected paths:
  - `supabase/migrations/0008_funds_bill_link.sql` — additive, nullable, and legacy rows stay null:
    ```sql
    alter table tblfundsrcvd add column fndsbillid integer;
    alter table tblfundsrcvd add constraint tblfundsrcvd_fndsbillid_fkey
      foreign key (fndsbillid) references tblbills(billid);
    create index tblfundsrcvd_fndsbillid_idx on tblfundsrcvd (fndsbillid);
    ```
  - `lib/db/types.ts` — regenerate with `pnpm db:types` so the `tblfundsrcvd` Row gains `fndsbillid: number | null`, and add that column to the "schema (money tables)" frozen contract above.
  - Apply to the hosted project with `supabase db push`, which needs Nate's own terminal.

## Not yet specified

- The legacy convention for `expchecknum` on card rows — this lane writes `0` ("no check"); verify against the real `.bak` before go-live
- Which legacy `tblexptype` rows have `active` null (treated as retired) — verify against the real `.bak`; reactivate by admin page if a live type is hidden

## Out of scope

- P&L, YearlyExpense, accountant export — `/reports` is docs-reports' lane
- Scanned check / bill images (`fndssafilename`, `fndsbillfilename` files) — docs-reports owns Storage; this lane stores numbers and names only
- Summing funds against a bill balance. The `fndsbillid` link (amendment above) records which check paid a bill; paid / partial stays an explicit admin action, never computed from linked amounts.
- Linking legacy funds rows to bills. Legacy never linked them, so migrated rows keep `fndsbillid` null.
- Card-export credits (payments to the card, refunds) — skipped by the importer, counted in its report; refunds entered by hand
- A live bank connection — file export only (quote)
- AI transaction categorization — AI off for v1 (CLIENT.md); the pre-sort is a frequency match
- Bill PDF / email — deferred add-on (MAP.md)

---

- task: Expense types — `lib/expenses/types.ts` exports `listActiveTypes(db)`
    (active = true, ordered by name), `addType(db, name)` (inserts active = true),
    `retireType(db, id)` (sets active = false) and `reactivateType(db, id)`.
    Admin page `app/expenses/types/page.tsx` lists all types with a retired
    marker and add / retire / reactivate controls; actions in
    `app/expenses/actions.ts`. Every later money form's type select reads
    `listActiveTypes`.
  guardrails:
    - Retire is a flag flip; no code path deletes a type or rewrites an expense's `exptype`
  done when:
    - Retiring a type sets `active=false`; the row still exists and every expense carrying it keeps its `exptype`
    - `listActiveTypes` returns only `active = true` types — a retired type and a legacy `active` null type are both absent
    - A staff user posting add or retire gets `?error=forbidden` and the table is unchanged; an admin's add creates an active row
  status: done

- task: Expense entry and edit — `app/expenses/new/page.tsx` and
    `app/expenses/[id]/page.tsx` share one form over all `tblexpenses` columns:
    date (default `firmToday()`), description, check number (required integer),
    type (active only), branch (default Stratford), amount, reason, initials,
    case (optional; `?case=` prefills it), bill (optional), cleared flag, date
    cleared, bank account, clearing notes, scanned check number, not-counted-in-
    profit amount. Writes in `lib/expenses/save.ts`. Unknown id → `notFound()`.
  guardrails:
    - A case id that doesn't exist in `tblcase` is rejected before insert, never written as a dangling FK
    - Editing never changes `expid`
  done when:
    - Saving `/expenses/new` with no case creates a `tblexpenses` row with `expcaseid` null (a firm-wide expense)
    - Saving with case 999999999 (nonexistent) shows a case field error and writes no row
    - Editing an expense's amount 45.00 → 50.00 persists 50.00, and `audit_log` holds an UPDATE for that `expid` with old 45.00 and new 50.00
  ui: true
  status: done
  parallel-group: a

- task: Funds entry, list, edit — `app/funds/new/page.tsx` form: case (required;
    `?case=` prefills), amount, date (default `firmToday()`), payee, source,
    type, branch (default Stratford), bank account, description, comment,
    cleared flag, date cleared, clearing notes. Save redirects to
    `app/funds/[id]/page.tsx`, which shows "Funds recorded" after a save and all
    fields with an edit form. `app/funds/page.tsx` lists recent funds (date,
    case, payee, amount), newest first. Writes in `lib/funds/save.ts`.
  guardrails:
    - Amounts are validated as at most 2 decimals; `fndspmt` is never written from a float
  done when:
    - Submitting `/funds/new` with case 990901 and amount 450.00 creates a `tblfundsrcvd` row (`fndspmt` 450.00, `fndsbranch` Stratford) and lands on a page showing "Funds recorded"
    - Amount `45.001` or `abc` shows an amount field error and writes no row
    - A nonexistent case id shows a case field error and writes no row
  ui: true
  status: done
  parallel-group: a

- task: Expense list — `app/expenses/page.tsx` with `?case=` and `?month=yyyy-mm`
    filters (default: current month); columns date, type name, description,
    check number, amount, cleared; a total row. Query in `lib/expenses/list.ts`,
    joining type names in one query, not per row.
  guardrails:
    - Read-only — no write from this page
  done when:
    - `/expenses?case=990901` lists only that case's expenses, shows the type name (not the id), and a total equal to the sum of their amounts
    - `/expenses?month=2026-01` lists every expense dated in January 2026, firm-wide (no case) rows included
    - Median of 5 loads of `/expenses?month=2026-01` stays under 1s with 5,000 expense rows seeded
  status: done

- task: Mark bill paid / partial payment — on `app/funds/[id]/page.tsx`, for
    admins: a bill select over the funds row's case's open bills (oldest
    first, oldest preselected; `?bill=` preselects a given bill) and two
    buttons. "Mark bill paid" sets `billnotice='Paid'` and `billpaiddate` = the
    funds row's `fndsdate`. "Record partial payment" sets
    `billnotice='Partial Payment'`. Write in `lib/funds/pay.ts`, guarded on the
    bill's current notice (`guardedUpdate` pattern). No open bills → the
    controls are replaced by "No open bills on this case".
  guardrails:
    - Only open bills (per `lib/bills/rules.ts`) are offered or accepted
    - Never writes `billsecondnoticedate`, `billfinalnoticedate`, `billbalance`, or any `tblcase` column
  done when:
    - "Mark bill paid" on an open `1st` bill sets `billnotice` 'Paid' and `billpaiddate` = the funds date, leaves 2nd/Final notice dates as they were, and the case page's `unpaid-bill-count` drops by 1
    - The paid bill no longer appears on `/bills`
    - "Record partial payment" sets 'Partial Payment' and the case's `unpaid-bill-count` is unchanged
    - A bill whose notice changed after the page loaded is not written; the page shows a stale-bill error
  ui: true
  status: done

- task: Bounced-check reversal — admin action "Reverse bounced check" on
    `app/funds/[id]/page.tsx` for a positive, not-yet-reversed funds row. It
    inserts a reversal row (same case, date `firmToday()`, `fndspmt` = −original,
    `fndstype='Bounced'`, `fndscomment` naming the original `fndsid`, other
    fields copied) and, when the user picks one of the case's Paid bills,
    reopens it: notice `Final` if `billfinalnoticedate` is set, else `2nd` if
    `billsecondnoticedate` is set, else `1st`; `billpaiddate` cleared. Write in
    `lib/funds/reverse.ts`; reopen rule a pure function there.
  guardrails:
    - The original funds row is never modified
    - A reversal row can itself never be reversed
    - Once-only must hold under two concurrent submits with no schema change — no guard that lives only in a prior select
  done when:
    - Reversing a 450.00 check creates one −450.00 row with `fndstype` 'Bounced' whose comment names the original `fndsid`; the original row is byte-for-byte unchanged
    - The picked Paid bill returns to `Final` when its final date is set, `2nd` when only its second date is set, `1st` when neither, with `billpaiddate` null
    - Two concurrent reversal submits for the same check leave exactly one reversal row
    - The case's `unpaid-bill-count` rises by 1 after a reversal that reopens a bill
  caution: true
  status: done

- task: BoA export upload — `lib/bank-import/parse.ts` parses the BoA CSV
    (`Date,Description,Amount`; quoted fields may contain commas; negative =
    outflow) into rows or a list of line-numbered errors. `lib/bank-import/import.ts`
    inserts outflows into `bank_transactions` with the chosen account, skipping
    rows the unique key already holds and skipping credits (amount > 0).
    `app/bank-review/page.tsx` gets the upload form: file input labelled
    "Upload CSV", account field prefilled "Bank of America"; result line
    "N transactions imported, M already imported, K credits skipped".
  guardrails:
    - Any parse error inserts nothing from that file (all-or-nothing)
    - Import never writes `tblexpenses` or `tblfundsrcvd`
  done when:
    - Uploading `tests/journeys/fixtures/boa-export.csv` inserts 2 `bank_transactions` rows with amounts −45.00 and −75.00 and `bankaccount` = the form value
    - Uploading the same file again inserts 0 rows and reports "2 already imported"
    - A file whose line 3 has a bad date reports an error naming line 3 and inserts no rows
    - A description `"SMITH, JONES LLP"` parses as one field; a +100.00 row is not inserted and counts as a skipped credit
  ui: true
  status: done

- task: Review inbox and confirm — `app/bank-review/page.tsx` lists
    `bank_transactions` with `expid` and `fndsid` both null, oldest first, under
    a "Transactions to review" heading. Per row: case (optional), expense type
    (active only, prefilled by the suggestion), description (prefilled), and a
    Confirm button. Confirm creates a `tblexpenses` row (`expdate` = posted date,
    `expamount` = absolute amount, `expchecknum` 0, `expbranch` Stratford,
    `expclearedbank` true, `expdatecleared` = posted date, `expbankaccount` = the
    import's account) and links it through `bank_transactions.expid`, then shows
    "Cleared". `lib/bank-import/suggest.ts` is a pure function: the type used
    most often on past expenses whose normalized description (lowercase,
    collapsed whitespace, digits stripped) matches; none when no match.
  guardrails:
    - Nothing reaches `tblexpenses` without a Confirm click
    - A concurrent double confirm must not leave a second cleared expense in the ledger — the insert-then-link ordering is the known hazard; a compensating removal of this request's own just-inserted row is the only permitted delete
  done when:
    - Confirming a row creates one `tblexpenses` row with `expclearedbank` true, `expdatecleared` = posted date, `expbankaccount` = the import account, sets that transaction's `expid`, and the row leaves the inbox showing "Cleared"
    - Two concurrent confirms of the same transaction leave exactly one `tblexpenses` row for it
    - With past expenses "COURT FILING FEE" ×3 as Filing Fee and ×1 as Case Material, a new "Court Filing Fee 0042" row is prefilled Filing Fee; an unmatched description has no preselected type
    - The type select contains no retired type
  caution: true
  ui: true
  status: done

- task: Clearing view by bank account — `app/bank-review/accounts/page.tsx`:
    account select over the distinct `expbankaccount` / `fndsbankaccount`
    values; lists that account's uncleared expenses and funds (date, kind,
    description/payee, amount); select rows, enter a cleared date and optional
    note, "Mark cleared" sets `expclearedbank`/`fndsclearedbank` true,
    `expdatecleared`/`fndsdatecleared`, and the clearing notes. Replaces Access
    `ClearedExpensesAndIncome`. Logic in `lib/bank-import/clearing.ts`.
  guardrails:
    - Only rows on the selected account are ever updated
  done when:
    - `/bank-review/accounts?account=X` lists only uncleared expenses and funds whose bank account is X
    - "Mark cleared" with date 2026-02-01 on two selected rows sets cleared true and date 2026-02-01 on exactly those rows, and they leave the list
    - A row on account Y submitted with account X selected is not updated
  ui: true
  status: done

- task: Case page money panels (wiring, cases) — replace
    `<Slot title="Funds received" />` and `<Slot title="Expenses" />` in
    `app/cases/[id]/page.tsx` with panels built in this lane
    (`app/funds/case-panel.tsx`, `app/expenses/case-panel.tsx`): each lists the
    case's rows (date, type/payee, amount, cleared) with a total and an "Add"
    link to `/funds/new?case=<id>` / `/expenses/new?case=<id>`.
  guardrails:
    - The case page's other panels, fields, and badges do not change; this item only replaces the two slots
  done when:
    - `/cases/990901` shows its funds rows and total under "Funds received" and its expenses and total under "Expenses"
    - The panels' Add links open the forms with the case prefilled
    - Existing cases, billing, and journeys 01–03 tests remain passing
  after: cases
  status: done

- task: Payment on the bills panel (wiring, billing) — in
    `app/bills/bills-panel.tsx`, a Paid bill shows its `billpaiddate`, and each
    open bill gets a "Record payment" link to `/funds/new?case=<id>&bill=<billid>`;
    `/funds/new` carries `bill` through to `/funds/[id]` so the pay select
    preselects that bill.
  guardrails:
    - `unpaid-bill-count`, `second-notice-date`, `final-notice-date` keep their test ids and meaning
  done when:
    - A Paid bill on the case bills panel shows its paid date
    - Clicking "Record payment" on bill N, saving funds, lands on the funds page with bill N preselected in the pay select
    - Existing billing and journeys 01–03 tests remain passing
  after: billing
  ui: true
  status: done

- task: Link a check to the bill it paid (added 2026-09-14; wiring, billing) —
    needs the `fndsbillid` amendment applied first. When "Mark bill paid" or
    "Record partial payment" runs on `/funds/[id]` (`lib/funds/pay.ts`), the
    funds row's `fndsbillid` is set to that bill. `/funds/[id]` shows
    "Applied to bill <billid>" with a link to the case's bill. The pay select
    is replaced by that line once the row is linked; a linked row can still be
    edited, and editing never changes `fndsbillid`. Reversing a linked check
    (`lib/funds/reverse.ts`) preselects its linked bill in the reopen select,
    and the reversal row carries the same `fndsbillid`. In
    `app/bills/bills-panel.tsx`, each bill lists its linked checks (date,
    amount, link to `/funds/<id>`), reversal rows included.
  guardrails:
    - A funds row links to at most one bill, and re-linking a linked row is refused; the link is written only by the pay action, never by funds edit
    - Two writes and no transaction: the bill update and the funds link update are each guarded in their own filter (bill: expected notice; funds: `fndsbillid is null`), their row counts are checked, and a lost link write compensates the bill back to its prior notice and paid date. Never leave a Paid bill without its link, or a link on a bill that was not paid by that row.
    - A bill's case and the funds row's case must match before either write
    - The original row of a reversed check is still never modified by the reversal
  done when:
    - "Mark bill paid" with bill N on funds row F sets `billnotice` Paid on N and `fndsbillid` = N on F; `/funds/F` then shows "Applied to bill N", and N on the case bills panel lists F's date and amount
    - "Record partial payment" links the same way, and a second check marking bill N paid is also linked, so N lists both checks
    - Paying from an already-linked row is refused with an error, and neither the bill nor the row changes; two concurrent pay submits from one row leave exactly one link and exactly one bill update
    - Reversing a linked check preselects its bill; the reversal row has the same `fndsbillid`, the original row is unchanged byte for byte, and the bill lists both rows
  after: billing
  caution: true
  ui: true
  status: done

> **⚠️ AUTONOMOUS RUN — STOP HERE**
