# Technology Associates — Feature Parity: legacy Access DB vs app

Every legacy Access object, what it does for the staff, and whether the new app matches it.
This file is the input for the `parity` lane (MAP.md) and its LANE.md.

- **Date:** 2026-09-21
- **App tree:** `plan-amend` worktree, off `origin/integration` (HEAD 1d3fee8)
- **Legacy sources:**
  - `DB_Technology_Associates (1).accdb`, read with mdbtools. It has 110 saved queries; the tables are ODBC links.
  - The exported VBA in `~/Downloads/TA_Files/vba-source/`: 71 form modules, 2 report modules and 6 standard modules.
  - LEGACY.md, MAP.md, MAP_PROGRESS.md, CLIENT.md and progress/*.md.
- **Status key:**

  | Status | Meaning |
  |---|---|
  | BUILT | App code found at the path given |
  | PARTIAL | App code exists; the gap is named |
  | MISSING | No app code. `→ billing-output` or `→ case-docs` means that lane owns it |
  | LIKELY-DEAD | No need to port; the reason is given |

- **Limits of the check:**
  - A form's RecordSource and control bindings are not in the exported `.bas` files.
  - So "unreachable" means no VBA and no other query references the object. It does not mean no form binds it.
  - Queries that are a form's own record source or combo row source are grouped under that form.

---

## 1. Cases, contacts, inquiries

| Legacy object | What it does for the user | Status | App location / gap |
|---|---|---|---|
| frmCaseUpdate (record, save) | Open a case by number, edit its fields, move to the previous or next case | BUILT | `app/cases/[id]/page.tsx`. `lib/cases/record.ts` has `saveCase` (diffs against `__orig`) and `loadCaseRecord` (prev/next) |
| frmCaseUpdate: LastUpdated stamp | Changing the status, priority, waiting-for, description, due date or point man stamps CaseStatLastUpdated | BUILT | `lib/cases/record.ts`: `STAMP_COLS` and `stamp()` |
| frmCaseUpdate: field auto-rules | See the list below this table | MISSING | `saveCase` has none of these four rules |
| frmCaseUpdate: badges (UpdateUnpaidBills32) | Warns about an unpaid bill, an unapproved SA, or no scanned fee schedule | PARTIAL | `lib/cases/record.ts` `badges()`. Unpaid and unapproved-SA are computed live. The fee-schedule badge reads the stored `numscannedfeeschedule`, which the app never updates. New cases (null) never warn, and uploads never clear it |
| frmCaseUpdate: EmailAtty | Starts an email to the case attorney, subject "Re: <caption>" | MISSING | The attorney email is plain text on the case page. There is no `mailto:` anywhere in app/ or lib/ |
| frmCaseUpdate: edit atty/client/firm buttons | Jump from the case to edit its attorney, client or firm | PARTIAL | The edit pages exist (`app/attorneys/[id]`, `app/clients/[id]`, `app/firms/[id]`), but the case page does not link to them |
| frmCaseUpdate: inquiry, SA, bill, time, funds, expense, document panels | Shows the case's related records | BUILT | `app/cases/[id]/page.tsx`: the inquiry link, ServiceAuthsPanel, BillsPanel, TimePanel, CaseFundsPanel, CaseExpensesPanel and CaseDocumentsPanel |
| frmCaseUpdate: NAS / front-desk folder buttons | Open the case's folder on the office NAS | LIKELY-DEAD | The NAS shares are gone under hosting; documents are stored in the app |
| frmCaseUpdate: cmdShowAct / cmdShowBill / cmdShowSA | Old toggle buttons | LIKELY-DEAD | Broken in legacy (they point at controls that no longer exist) |
| frmCaseUpdate: 4 Word documents | Prefilled case documents | MISSING → case-docs | See §8 |
| frmCaseAdd (+ qryAddCase) | Add a new case with the next case number | PARTIAL | `app/cases/new`, `lib/cases/create.ts`. `nextCaseId` is max+1 over **all** cases; legacy takes max CaseID **below 10000**. The index-card print on save is missing (next row) |
| frmCardDialog, rptIndexCards, rptIndexCardsAfter | Print the new case's index card, 1–4 copies | MISSING | No index-card page. `/cases/[id]/rolodex` prints the attorney rolodex card, not the case index card |
| rptRolodexCard / qryRolodexCard | Print an attorney rolodex card | BUILT | `app/cases/[id]/rolodex`, `rolodexLines` in `lib/cases/record.ts` |
| rptAddressLabel / qryAddressLabel | Print the mailing label for the case attorney | BUILT | `app/cases/[id]/label`, `labelLines` in `lib/cases/search.ts` |
| CaseSearch, CaseSearchResults, CaseSearchQueryView, main-menu case box | Quick search: case #, title, notes, caption, attorney, firm, client, other experts | BUILT | `lib/cases/search.ts` `quickSpec`, `app/cases/search` |
| frmSearchInput, frmSearchResults, qrySearch | Field-by-field case search with AND/OR | BUILT | `lib/cases/search.ts` `advancedSpec`: same fields, strict `startdate >`, AND/OR |
| frmSearchList, frmSearchListResults, qryCaseList, qryCaseListTitleOnly | Browse the case list, newest first; show all cases | BUILT | `lib/cases/search.ts` `listCases` (newest, roster, titles) |
| Work Status Sheet, Work Status query (+ COPY) | Open work per point man, by due date or by priority | PARTIAL | `lib/cases/presets.ts` `workStatus` and `app/cases/lists/work-status` (+ print) match the query. The sheet's automatic "(date) " prefix on the description is missing |
| frmWaitingFor, qryWaitingFor, qryIncomeCaseTotal | Cases waiting on an advance or materials, with funds received | BUILT | `lib/cases/presets.ts` `waitingFor`, `app/cases/lists/waiting-for`. The Provided_Docs NAS button is dead (NAS) |
| OtherExpertsSearch | Find cases by the other expert involved | BUILT | `lib/cases/presets.ts` `otherExperts`, `app/cases/lists/other-experts` |
| DatabaseActivity Form, Query_DatabaseActivity | Recent activity: status updates, SA approvals, new SAs | BUILT | `lib/cases/presets.ts` `recentActivity` (35 days), `app/cases/lists/recent` |
| frmAddAtty, frmAddClient, frmAddFirm | Add a contact from inside the new-case form | BUILT | `lib/contacts/actions.ts` `saveContact`; `safeReturnTo` in `lib/cases/create.ts` |
| frmEditAtty, frmEditClient, frmEditFirm, frmFirmDisp (+ qryFirmInfo, qryFirmUpdate, qryClientUpdate) | Pick and edit an attorney, client or firm | BUILT | `app/attorneys/[id]`, `app/clients/[id]`, `app/firms/[id]`; `lib/contacts/contacts.ts` |
| qryActiveFirms, qryByState | Contact lists by active flag, or by the firm's state | BUILT | `lib/contacts/presets.ts`, `app/attorneys/lists` |
| qryFindDupAttys, qryFirmNameChange, qryUpdateAttyID | Duplicate-cleanup worksheets | BUILT | Ported as read-only presets in `lib/contacts/presets.ts` |
| Add New Inquiry (+ qryAddInquiry) | Log a new inquiry | BUILT | `app/inquiries/new`, `lib/inquiries/inquiries.ts` `createInquiry` |
| Add New Inquiry: deadbeat check | Warns when the firm or attorney matches an unpaid deadbeat bill | MISSING | No deadbeat lookup in `lib/inquiries` or `app/inquiries` |
| Add New Inquiry: email/PDF | Emails the inquiry as a PDF to Kris | MISSING | No inquiry email or PDF |
| frmMainMenu: website-lead import | Pastes a website contact-form lead into a new inquiry (branch CTA, receptionist Kalpna, how-heard "TA Website") | MISSING | No import |
| frmInquiryEdit, Edit Existing Inquiry from List, frmInquiryDisplay (+ qryInquiry) | View and edit an inquiry | BUILT | `app/inquiries/[id]`, `updateInquiry` (with `__orig` guard) |
| Inquiry → case | Make a case from an inquiry | BUILT | `lib/inquiries/convert.ts`, `app/inquiries/[id]/convert-panel.tsx` |
| InquirySearch, InquirySearchResults, InquirySearchQuery (main-menu box) | Quick search over 16 inquiry fields | BUILT | `lib/inquiries/inquiries.ts` `QUICK_SEARCH_FIELDS` and `quickSearch`, same field order |
| frmInquirySearch (+ qryInquirySearch) | Search inquiries by date range, attorney, subject, location, branch, referred-by and resulting case, with AND/OR | PARTIAL | `advancedSearch` covers every field and date mode, but AND only. The OR mode is missing |
| qryHowYouHeardAboutUs | Inquiries by how they heard of TA | BUILT | `byHowHeard` (a typed term replaces the hard-coded "*alm*") |
| frmAddInquiry, Edit One Existing Inquiry | Old inquiry forms | LIKELY-DEAD | Unreachable from the menu; superseded by Add New Inquiry and Edit Existing Inquiry from List |
| frmCaseNum | Old open-case-by-number launcher | LIKELY-DEAD | Unreachable; the main menu opens frmCaseUpdate directly |

The four frmCaseUpdate auto-rules:
- A status change prefixes "(m/d/yy initials) " to the case-status text.
- CLOSED sets the end date to today; any other status clears it.
- A WaitingFor change sets the priority to (1) Active or (2) Waiting.
- Choosing "(2) Waiting" clears two fields.

## 2. Service authorizations

| Legacy object | What it does for the user | Status | App location / gap |
|---|---|---|---|
| frmCaseServAuth (+ qryServAuth) | List, add and edit a case's service authorizations | BUILT | `app/cases/[id]/service-auths.tsx`, `lib/cases/service-auths.ts` `saveServiceAuth` / `loadServiceAuths` |
| frmCaseServAuth: SrvDateApproved rule | Stamps the approval date on a decision status; clears it otherwise | PARTIAL → billing-output | The app stamps only Approved / Modified and Approved, and never clears. Legacy stamps Approved, Declined, Modified and "Modified and Approved" when empty, and sets Null for every other status. The billing-output LANE.md owns "approval date follows the legacy stamp rule" |
| SA document generation | Writes the SA document the attorney signs | MISSING → billing-output | |
| frmServAuthUnapproved, qryServAuthAwaitingApproval | SAs that are Awaiting Approval or Modified | BUILT | `SA_LISTS.unapproved`, `app/cases/service-auths` |
| qryServAuthApproval | Awaiting Approval only | BUILT | `SA_LISTS.awaiting` |
| frmServAuthApproved, qryServAuthApproved | Recently approved SAs | BUILT | `SA_LISTS.approved` |
| SA list totals, qrySrvAuthTotal | Hours and count per status | BUILT | `serviceAuthTotals`, `serviceAuthGrandTotal` |
| NumUnapprovedSA badge | Warns on the case | BUILT | Live, in `badges()` in `lib/cases/record.ts` |
| qryServAuthInfo | One case's SA info | LIKELY-DEAD | Case 1124 is hard-coded; scratch |

## 3. Time

| Legacy object | What it does for the user | Status | App location / gap |
|---|---|---|---|
| KJS Excel timesheet (Time_Sheet_KJS.xlsm), read by modBillingAndServAuth `BillingDataFromTimeSheet` | Per-case time rows that feed a bill | BUILT | Replaced by in-app time (MAP.md): `app/time`, `lib/time/entries.ts`, `week.ts`, `timer.ts` |
| Timesheet "billed" marking | Marks time rows as billed | BUILT | `lib/bills/create.ts` claims the checked `tblactivity` rows |
| qryUnbilledCases | Cases with unbilled time | BUILT | `lib/time/unbilled.ts` `unbilledByCase` |
| Timesheet hourly rate (cell O1) | Rate per case for pricing | MISSING → billing-output | The rate is set per person at finalize (MAP.md). The real rate card stays deferred |

## 4. Billing and notices

| Legacy object | What it does for the user | Status | App location / gap |
|---|---|---|---|
| frmCaseBill (+ qryBills, qryBillByCase, qryBillInfo) | A case's bills: list, open, edit | BUILT | `app/bills/bills-panel.tsx`, `app/bills/[id]`, `lib/bills/case.ts`, `lib/bills/edit.ts` |
| frmCaseBill: make bill (6 types) | Creates the bill record and file name | BUILT | `lib/bills/create.ts`, `billFileName` in `lib/bills/rules.ts`. This is the record only |
| frmCaseBill: bill document/PDF for the 6 types, with rates and rounding | The actual invoice | MISSING → billing-output | |
| frmCaseBill: retainer default | A retainer bill starts at $4500 with the comment "Initial Advance" | MISSING → billing-output | No default in `lib/bills/create.ts` |
| frmCaseBill: 2nd / Final notice date stamps | Advancing a notice stamps its date if empty | BUILT | `lib/bills/notice.ts` `advanceNotice` (guarded; never overwrites a date) |
| frmCaseBill: BillPaidDate stamp | Paid, Cancelled, Settled, Carried Over, Refund and Credit stamp the paid date if empty | PARTIAL | Only Paid stamps it (`lib/funds/pay.ts`, with the check date). `closeBill` (Cancelled, Carried Over, Settled, Deadbeat) writes the notice only. A Credit or Refund bill is created without a paid date |
| frmCaseBill: bill email (CC kpatel + BillingCC) | Emails the bill | MISSING → billing-output | The BillingAlert and BillingCC fields are stored and shown (`app/bills/recipient-alert.tsx`) |
| frmBillUnpaid (+ UnpaidBillsQuery, UnpaidEstimated) | Unpaid bills with ageing colours, totals, and the attorney to call | PARTIAL | `/bills`: `lib/bills/list.ts`, `app/bills/bills-list-view.tsx`. It shows open bills by stage, days since the last notice, and a due badge at 30+ days. Missing: the 30/59/90-day colour bands, the estimate and non-estimate totals, and the attorney and firm phone columns. Auto-dial is obsolete |
| frmBillUnpaid: 2nd/Final resend with stamp image | Re-sends the stored bill as a notice | MISSING → billing-output | |
| frmBillPaid, qryBillPaid, qryBillPaid_llb_2 | All paid bills, newest paid first, sortable | MISSING | `/bills` lists open bills only; paid bills show only on each case's panel |
| frmBillDeadbeat, qryBillDeadbeat | Deadbeat bills with attorney and phone | PARTIAL | Deadbeat is a group on `/bills` (`OPEN_NOTICES` in `lib/bills/rules.ts`), without the attorney, title and phone columns |
| NumUnpaidBills, NumUnpaidBillsUpdateQuery | Stored unpaid count shown on the case | BUILT | Replaced by the live unpaid badge in `badges()`. The stored-count update query is maintenance |
| qryBillTotal | Paid totals by date | LIKELY-DEAD | Not referenced by any VBA or query |

## 5. Money: expenses, income, clearing

| Legacy object | What it does for the user | Status | App location / gap |
|---|---|---|---|
| frmExpenseEntry (+ qryExpenseEntry) | Enter an expense | BUILT | `app/expenses` new/[id], `lib/expenses/save.ts` (every column, including not-counted-in-profit and the scanned check number) |
| frmExpenseView, frmExpenseEdit (+ qryExpenseView, qryExpenseEdit) | Browse and edit recent expenses | BUILT | `app/expenses/page.tsx`, `lib/expenses/list.ts`, by month or by case. Legacy showed a 365-day or date-range grid |
| frmExpenseEntry/View: view scanned bill/check | Opens the scanned check by its check number | MISSING | `exp_scanned_check_number` is stored, but nothing looks it up; `tbl_scannedbillandcheck` is read nowhere in app/ or lib/ |
| Expense types, qryExpTypeOrdered, qryExpInitOrdered | Type and initials pick lists | BUILT | `lib/expenses/types.ts` (retire, never delete), `app/expenses/types`; the initials select in `app/expenses/expense-form.tsx` |
| frmIncomeEntry (+ qryIncomeENTRY) | Record a check received | PARTIAL | `app/funds/new`, `app/funds/[id]`, `lib/funds/save.ts`. See the list below this table |
| frmIncomeVIEW, frmIncomeEdit (+ qryIncomeVIEW, qryIncomeEdit) | Browse and edit income over a date range | PARTIAL | `app/funds/page.tsx` shows the last 100 rows. There is no date-range filter (legacy: 800 days, or a range grid) |
| Funds → bill Paid / Partial Payment | Applies a check to a bill | BUILT | `lib/funds/pay.ts`; reversal in `lib/funds/reverse.ts` |
| frmExpenseCase, subFrmExpenseCase, qryExpenseCase | A case's expenses and their total | BUILT | CaseExpensesPanel on the case page |
| frmIncomeCase, subFrmIncomeCase, qryIncomeCase, tblFundsRcvdByCase Query | A case's income and its total | BUILT | `lib/funds/case.ts`, `app/funds/case-panel.tsx` |
| frmExpenseAndIncomeCase | Both panels together | BUILT | Case page |
| ClearedExpensesAndIncome (+ qryForCheckbookComparisonExpense/Income) | Checkbook reconciliation over a date range: Expenses, Non-profit, Income, Net, CheckBook, Total withdrawals | PARTIAL | `lib/bank-import/clearing.ts` and `app/bank-review` mark rows cleared per account. The date-range totals (list below) are missing |
| sum_by_check | Expense total per check number | LIKELY-DEAD | No VBA or query reference; ad-hoc |

frmIncomeEntry gaps in the app:
- Entering a case # does not autofill Source (the formatted attorney), Payee (the firm) or the case title.
- There is no remaining balance (the bill's balance − this payment).
- The Cleared box does not stamp today's date; the date is typed by hand.
- There are no open-bill, open-SA-file or open-scan buttons.

ClearedExpensesAndIncome totals missing from the app:
- Expenses = Σ ExpAmount
- Non-profit = Σ Exp_NotCountedInProfit
- Income = Σ FndsPmt
- Net = Income − Expenses
- CheckBook = Income − Expenses − Non-profit
- Withdrawals = Expenses + Non-profit

## 6. Scanned documents and documents

| Legacy object | What it does for the user | Status | App location / gap |
|---|---|---|---|
| frmScannedCase (+ qryScannedDocsCase) | A case's scanned documents: add, list, open | PARTIAL | `app/documents`, `lib/documents/store.ts`, CaseDocumentsPanel. Upload, list and download work. `type` now holds the MIME type, so the legacy document category (Fee_Schedule, Service…, Received_Check…) is neither kept nor settable. That is also why the fee-schedule badge can't be live |
| frmScannedCase: "grab newest scan" | Copies the newest file from `\\Tech02\NETWORK_SCANS` | LIKELY-DEAD | Network share; replaced by upload |
| frmScannedCase: Mail_Report | On a Service or Received_Check document, emails "Service authorization received / Income received for Case #…" to jhartzsch and kseluga, with the point men and the first 2 status lines | MISSING | No notification. Needs the document category first |
| frmScannedCase: email rptAddressLabel | Emails the address label | MISSING | The label page exists (`/cases/[id]/label`); email does not |
| frmScannedBillCheck (tbl_ScannedBillAndCheck) | Scanned vendor bills and checks, by check number | MISSING | The table is migrated but has no UI |

## 7. Reports and analysis

| Legacy object | What it does for the user | Status | App location / gap |
|---|---|---|---|
| frmFinancialRptBasic (hub) | Date range with ±day buttons, report buttons | BUILT | `app/reports/page.tsx` (start/end dates, preset buttons) |
| frmExpenseReport (cmdFindExp) | Find expenses by range + description + type + check # | PARTIAL | `lib/reports/detail.ts` `expenseDetail`: the page has no filter inputs; the description matches `expdscr` only (legacy ExpDscr **or** ExpReason); there is no check # filter |
| frmIncomeReport (cmdFindIncome) | Find income by range + case # + branch + attorney + payee | PARTIAL | `incomeDetail`: no case #, attorney (FndsSource) or payee filter; branch and description are not on the page |
| frmExpenseByMonth (+ qryExpenseByMonth, qryMonthlyExpenseType) | A month's expense rows and totals per type | BUILT | The `monthly-expense` preset in `lib/reports/presets.ts`; `expenseDetail` per-type summary |
| frmIncomeByMonth (+ qryIncomeByMonth, qryMonthlyIncomeBranch) | A month's income rows and totals per branch (CATA, CTA, FTA, FTASO, NYTA) | PARTIAL | The `monthly-income` preset gives a grand total only; per-branch totals are missing |
| frmYearlyExpense (+ xtabExpenses) | Type × month crosstab, optionally cut off at an end month | PARTIAL | `lib/reports/matrix.ts` `monthMatrix(year,"exptype")` covers the full year only; there is no end month |
| frmYearlyIncome, rptYearlyIncome (+ xtabFundsReceived) | Branch × month crosstab | BUILT | `monthMatrix(year,"branch")` |
| frmYearlyReport (+ xtabFundsBal) | Monthly Income, Expense, "Unc" (not counted in profit) and Net | PARTIAL | `lib/reports/pnl.ts` matches legacy: Net = Inc − Exp, withdrawals on a memo row not subtracted. `pnl` takes `asOfMonth`, but the preset hard-codes 12 |
| CTPTE_Reports (main menu) | CT PTE quarter-end copies of the yearly report and yearly expense, cut at the quarter's last month | MISSING | Needs an end month on the P&L and the yearly expense |
| frmYearlyExpenseInit (+ xtabExpensesInit) | Yearly expenses by the initials who spent them | MISSING | `monthMatrix` has no initials dimension |
| Ctl1099_Find_Total_Income | A payer's total income for a calendar year (for 1099s) | MISSING | |
| Main menu tax docs | 12 monthly income + 12 monthly expense + yearly income, expense and financial report, each as PDF **and** XLS, plus the consultant reports | PARTIAL | `lib/reports/export.ts` `accountantPlan`: 27 XLSX sheets. Missing: PDF copies, and the All_Consultants and Liberum_Advisors_Fees sheets |
| Consultant fee reports (SetSQLStr, type 18) | All consultant fees for the year; Liberum Advisors fees | PARTIAL | The `consultant-fees` preset filters `description: "consultant"`, but legacy filters **expense type 18** with no description. There is no Liberum cut |
| CasesPerYear (report) | Number of cases opened per year | MISSING | No report |
| InquiriesPerYear (report) | Number of inquiries per year | MISSING | No report |
| Analysis_Bill_Payments_by_firm (+ Query–Query7), Analysis_cases_by_firm, Analysis_Income_By_Case, Analysis_Income_By_Firm(_Last_365_days), Income from previous/unfinished cases, qryLastThreeYearsIncomeByCase, queryIncomeTotalByCase | Ad-hoc income-by-firm and income-by-case analyses | LIKELY-DEAD | No VBA or form caller; hard-coded windows and exclusions (atty 1747). See Questions |
| qryBranchIncome, qryIncome, qryExpenses, qryExpTot, qryIncomeTotalTemp | Scratch totals | LIKELY-DEAD | No caller. qryExpenses hard-codes branch CTA; qryIncomeTotalTemp dates from 2003 |

## 8. Case document generation

| Legacy object | What it does for the user | Status | App location / gap |
|---|---|---|---|
| frmCaseUpdate: Inspection_Plan | Prefilled Word inspection plan | MISSING → case-docs | |
| frmCaseUpdate: _Memo | Prefilled Word memo | MISSING → case-docs | |
| frmCaseUpdate: CTA_REPORT | Prefilled Word report | MISSING → case-docs | |
| frmCaseUpdate: File_Review_Summary | Prefilled Word file review | MISSING → case-docs | |

## 9. Admin and utility

| Legacy object | What it does for the user | Status | App location / gap |
|---|---|---|---|
| frmMainMenu (navigation, search boxes, open-case box) | Start screen | BUILT | `lib/auth/sections.ts` (header nav), `app/page.tsx` search boxes, `app/dashboard` |
| frmMainMenu: About → rptReleaseNotes (localReleaseNotes) | Release notes of the Access front end | LIKELY-DEAD | Describes Access versions only |
| frmMainMenu: front-desk gate (This_Is_Front_Desk.txt) | Only the front-desk PC may export tax docs | LIKELY-DEAD | Replaced by app roles |
| frmSplash (RunOneDrive), remote sync, backup | Startup, OneDrive sync | LIKELY-DEAD | Obsolete under hosting (MAP.md) |
| frmOOPS (Remove_DBO_Prefix) | Renames linked ODBC tables | LIKELY-DEAD | Access maintenance |
| modGeneric: FormatAttyName, FormatAddress, zip, CheckNoDots | Name and address formatting | BUILT | `labelLines` in `lib/cases/search.ts`; `rolodexName` and `attorneyName` in `lib/cases/record.ts` |
| modGeneric: OrderByThis | Click a list header to sort | PARTIAL | App lists use a fixed order. It matters for the paid and deadbeat bill lists; see §4 |
| modAutomation, basWinAPI | Word, Excel and Thunderbird automation; Windows API | LIKELY-DEAD | Helpers for the Word, Excel and email features above; the lanes replace them |
| basError, modHandleErrors, frmError_AB, frmCauseError_AB, frmOrders_AB | Error handling and template samples | LIKELY-DEAD | `_AB` template objects and Access error plumbing |
| TaxDocDatasheetView (macro) | Datasheet view used by the tax-doc export | LIKELY-DEAD | A helper of the tax-doc export (§7) |
| SAVEfrmIncomeByMonth | Old copy of frmIncomeByMonth | LIKELY-DEAD | A SAVE* copy |
| appImportAtty/Cases/Clients/Firms, qryImportAtty/Cases/Clients/Firms, qryDeleteAttys/Firms, qryDeleteMe, qryUpdate, qryUpdateAttys, qryUpdateDirectFromMain | One-time import, delete and update jobs | LIKELY-DEAD | Maintenance; the migration lane moved the data |
| qrySearchTemplate, tblActive Query, tblCase Query(1), tblExpenses Query, tblInquiry Query, tblFundsRcvd Query | Scratch queries | LIKELY-DEAD | qrySearchTemplate references a missing `tblCases`; the others are unsaved-style scratch |

---

## Business rules to preserve

| # | Rule (legacy source) | Handled? | Where / gap |
|---|---|---|---|
| 1 | A status, priority, sub-priority, waiting-for, description, due date, due-date text or point-man change stamps CaseStatLastUpdated (frmCaseUpdate, Work Status Sheet) | handled | `lib/cases/record.ts` `STAMP_COLS` and `stamp()` |
| 2 | On exit, CaseStatus text gets a "(date initials) " prefix unless it already starts with "(" (frmCaseUpdate) | not handled | Initials came from the PC name (TECH04=KJS, DESKTOP-JKODT18=KP, TECH05=JH); the app would take them from the session |
| 3 | Status CLOSED → case end date = today; any other status → end date cleared (frmCaseUpdate `Status_AfterUpdate`) | not handled | `saveCase` |
| 4 | A WaitingFor change sets the priority: empty → "(1) Active", non-empty → "(2) Waiting", unless the priority is "(9) Inactive/Closed" (frmCaseUpdate `Text74_Change`) | not handled | `saveCase` |
| 5 | Choosing priority "(2) Waiting" clears two fields, Text72 and Text97 (frmCaseUpdate `Priority_Change`) | not handled | The bound columns are unknown; see Questions |
| 6 | A Work Status Sheet description is prefixed "(date) " | not handled | `app/cases/lists/work-status` |
| 7 | New case # = max CaseID below 10000, + 1 (frmCaseAdd) | not handled | `lib/cases/create.ts` `nextCaseId` takes the max over all cases |
| 8 | The fee-schedule warning shows when a case above 1850 has no Fee_Schedule scan (UpdateUnpaidBills32) | not handled (stale) | `badges()` reads a stored count that nothing updates |
| 9 | Unpaid = 1st, 2nd, Final or Partial Payment (UnpaidBillsQuery) | handled, wider | The badge's `UNPAID_NOTICES` also counts Deadbeat and Small Claims; the `/bills` `OPEN_NOTICES` adds Deadbeat. Deliberate, but the two lists differ on Small Claims |
| 10 | 2nd / Final stamp their notice date if empty (frmCaseBill) | handled | `lib/bills/notice.ts` `advanceNotice` |
| 11 | Final clears PaidDate (frmCaseBill) | handled | Only open bills advance, and an open bill has no paid date in the app |
| 12 | Paid, Cancelled, Settled, Carried Over, Refund and Credit stamp BillPaidDate if empty (frmCaseBill) | partly | Paid only (`lib/funds/pay.ts`, with the check date). `closeBill` and Credit/Refund creation leave it null |
| 13 | Retainer bill defaults to $4500, "Initial Advance" | not handled → billing-output | |
| 14 | SrvDateApproved is stamped when empty for Approved, Declined, Modified and "Modified and Approved"; any other status sets it Null (frmCaseServAuth) | partly → billing-output | `lib/cases/service-auths.ts` stamps only Approved / Modified and Approved, and never clears |
| 15 | SA lists: unapproved = Awaiting Approval + Modified; awaiting = Awaiting Approval; approved = Approved + Modified and Approved; case-insensitive | handled | `SA_LISTS` |
| 16 | Income Cleared checkbox sets FndsDateCleared to today; unchecking clears it (frmIncomeEntry) | not handled | `lib/funds/save.ts` takes the date as typed. Bank-review clearing stamps its own date (`lib/bank-import/clearing.ts`) |
| 17 | P&L: Net = Income − ExpAmount; Exp_NotCountedInProfit is shown separately and **not** subtracted (frmYearlyReport) | handled | `lib/reports/pnl.ts` (withdrawals memo row) |
| 18 | Monthly and yearly expense totals sum ExpAmount only; the not-counted amount is outside them (frmExpenseByMonth, xtabExpenses) | handled | `lib/reports/detail.ts`, `lib/reports/matrix.ts` sum `expamount` |
| 19 | Checkbook = Income − Expenses − NotCounted; Withdrawals = Expenses + NotCounted (ClearedExpensesAndIncome) | not handled | No reconciliation totals |
| 20 | Consultant fees = expense type 18 for Jan 1 – Dec 31; Liberum = type 18 + description "Liberum" (frmMainMenu tax docs) | not handled | The `consultant-fees` preset filters description "consultant" |
| 21 | Expense find: description matches ExpDscr OR ExpReason; check # is used only when description and type are blank (frmFinancialRptBasic) | not handled | `expenseDetail`: `expdscr` only, no check # |
| 22 | 1099 total = Σ FndsPmt where UCase(FndsPayee) LIKE the payer, over the calendar year | not handled | |
| 23 | Case quick search fields and inquiry quick-search field order | handled | `lib/cases/search.ts` `quickSpec`; `lib/inquiries/inquiries.ts` `QUICK_SEARCH_FIELDS` |
| 24 | Case field search: StartDate is a strict `>`; status is exact | handled | `advancedSpec` |
| 25 | Work status list: priority not null and not like *9*; point man = target or null; due date nulls last | handled | `lib/cases/presets.ts` `workStatus` |
| 26 | Inquiry deadbeat check: 4+ character words, firm suffix words stripped, partial match against qryDeadbeat (Add New Inquiry) | not handled | |
| 27 | Website lead import defaults: branch CTA, receptionist Kalpna, how-heard "TA Website" | not handled | |

---

## Already planned elsewhere

These rows are listed above as MISSING or PARTIAL; they are not parity-lane work.

**→ billing-output** (LANE.md written):
- Bill PDF for all 6 types, with rates and rounding (modBillingAndServAuth).
- The timesheet rate, replaced by a per-person rate at finalize.
- The retainer $4500 / "Initial Advance" default.
- The bill email (CC kpatel + BillingCC).
- The 2nd/Final notice resend with the stamp image (frmBillUnpaid).
- SA document generation.
- The SrvDateApproved stamp rule (rule 14).

**→ case-docs** (gated on the .dotx templates):
- Inspection_Plan
- _Memo
- CTA_REPORT
- File_Review_Summary

---

## Summary

### Counts

Counted by table row in §1–§9. `→ lane` rows are included in their status.

| Status | Rows | of which → billing-output / → case-docs |
|---|---|---|
| BUILT | 45 | — |
| PARTIAL | 21 | 1 (SA stamp rule → billing-output) |
| MISSING | 27 | 11 (6 → billing-output; 5 → case-docs, counting the §1 pointer row) |
| LIKELY-DEAD | 20 | — |
| **Total** | **113** | |

This leaves 20 PARTIAL and 16 MISSING rows for the parity lane.

### Candidate parity-lane items

Each item is one logical change. None is owned by billing-output or case-docs.

1. **Case-record auto rules.**
   - Scope: rules 2–5 in `saveCase`: the status-note "(date initials)" prefix from the session, CLOSED → end date, WaitingFor → priority, and "(2) Waiting" clears.
   - Takes over: `lib/cases/record.ts`.
   - Blocked on: rule 5 waits on the Kris question about Text72/Text97.
2. **Work Status description date prefix** (rule 6).
3. **Next case number below 10000** (rule 7), pending the Kris answer.
4. **Case page links.**
   - `mailto:` to the attorney, with subject "Re: <caption>".
   - Edit-attorney, edit-client and edit-firm links.
5. **Document category plus a live fee-schedule badge.**
   - A category on upload (Fee_Schedule / Service / Received_Check / Other), migrated from the legacy `type`.
   - The badge computed from documents instead of `numscannedfeeschedule`.
6. **Scanned-document notification email.**
   - "Service authorization received" or "Income received" to jhartzsch and kseluga, with the point men and the status lines.
   - Depends on item 5.
7. **Scanned bills and checks.**
   - A UI over `tbl_scannedbillandcheck`.
   - A "view scanned check" lookup from an expense by check number.
8. **Income entry helpers.**
   - Case # autofills source, payee and title.
   - Remaining balance against the chosen bill.
   - Cleared stamps today (rule 16).
9. **Income list date-range filter** (frmIncomeVIEW/Edit).
10. **Checkbook reconciliation totals** for a date range (rule 19), on bank-review or reports.
11. **Report filter inputs.**
    - Expense: type, description over dscr + reason, check #.
    - Income: case #, attorney/source, payee, branch.
    - Rule 21.
12. **Monthly income per-branch totals.**
13. **End month on the P&L and the yearly expense**, plus CT PTE quarter-end presets.
14. **Consultant presets.**
    - Fix `consultant-fees` to exptype 18.
    - Add the Liberum cut.
    - Add both to the accountant export.
15. **Tax-docs PDF copies** alongside the XLSX export. Blocked on the Kris question.
16. **Yearly expense by initials** (frmYearlyExpenseInit).
17. **1099 payer-year income total** (rule 22).
18. **Cases per year and inquiries per year reports.**
19. **Bill lists.**
    - A paid-bills list, newest paid first.
    - Deadbeat attorney, title and phone columns.
    - Unpaid ageing bands of 30/59/90 days.
    - Estimate and non-estimate totals.
    - Header sort (OrderByThis).
20. **BillPaidDate on close-as and Credit/Refund** (rule 12). Sequence after billing-output, which owns `lib/bills/**`.
21. **Inquiry deadbeat check** on new inquiries (rule 26).
22. **Inquiry email/PDF to Kris** on save.
23. **Website-lead paste import** into a new inquiry (rule 27).
24. **Inquiry advanced search OR mode.**
25. **Case index card print** (rptIndexCards, 1–4 copies) after adding a case.
26. **Email the address label.** Low value; confirm with Kris first.

---

## Questions for Kris

1. **"(2) Waiting".** Choosing "(2) Waiting" as the priority clears two fields on the case screen (Text72 and Text97). Which fields are they, and should that still happen?
2. **Case numbers above 10000.** New case numbers skip anything at 10000 or above. Are there cases numbered 10000+ (test cases, a special series)? Should the app keep skipping them?
3. **Index cards.** Do you still print the index card when a case is added?
4. **Tax docs.** The accountant gets the monthly and yearly reports as PDF **and** Excel. Does the accountant need the PDFs, or is Excel enough?
5. **Consultant reports.** They filter expense type 18, with a separate Liberum Advisors cut; Hmurcik and Dingee are commented out. Is type 18 still the consultant type, and are Liberum and "all consultants" the only cuts needed?
6. **Analysis queries.** Are the "Analysis_…" income-by-firm and income-by-case queries (the last 365/800 days, attorney 1747 excluded) ever run? Or can they go?
7. **Scanned-document emails.** When a service authorization or a check is scanned, Access emails Joanne and Kris. Is that email still wanted, and to whom?
8. **Scanned vendor bills and checks** (tbl_ScannedBillAndCheck). Are these still scanned and looked up by check number? Were the old files kept anywhere we can migrate them from?
9. **Monthly income by branch.** It totals by branch (CATA, CTA, FTA, FTASO, NYTA). With one branch now, do you need the per-branch split for past years?
10. **Cases per year and inquiries per year.** Are these reports used?
11. **Inquiry emails.** Should a new inquiry still email Kris a PDF copy?
