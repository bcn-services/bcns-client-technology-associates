# LEGACY.md — Technology Associates existing system

Reverse-engineered 2026-08-19 from client-supplied files (Access front-end
`DB_Technology_Associates.accdb`, SQL Server backup `TechAssoc26-08-18.bak`,
ODBC DSNs, backup scripts, `Expenses.docx`). Schema below was extracted from the
`.bak` metadata pages — no SQL Server instance was restored, so types and
nullability are NOT captured, only table/column names.

## Shape of the existing system

Access front-end (`.accdb`) → ODBC → SQL Server Express `TechAssoc`.

- Remote server: `32.217.18.252\SQLEXPRESS` (DSN) / `47.23.189.154\SQLEXPRESS`
  (backup script) — SQL auth, user `TechAssoc`. Remote access via WireGuard.
- Local mirror: `DESKTOP-JKODT18\LOCAL_SQLSRV`, restored from a nightly `.bak`.
- Nightly `BackupRemote.bat`: BACKUP → 7-zip → S3 (`techassoc-tranfer` bucket)
  via S3 Browser CLI.
- Front-end inventory: **22 ODBC-linked tables, 110 queries, 71 forms,
  8 reports, 6 VBA modules**. This is a full case-management + billing +
  accounting system, not just expenses.
- `SSMA_TimeStamp` on most tables → the DB was migrated from Access to SQL
  Server with SSMA at some point.

## Tables

### tblCase
CaseID, CaseAtty, CaseTitle, CaseCaption, CaseSubject, CaseClient, TABranch,
Status, CaseNotes, CaseStartDate, CaseEndDate, CaseStatPriority,
CaseStatBriefDescription, CaseStatDescription, CaseStatPointMan,
CaseStatDueDate, CaseStatHardDeadline, CaseStatWaitingFor, CaseStatLastUpdated,
CaseStatSubPriority, CaseStatDueDateDescription, CaseInquiry, CaseAttyReference,
NumUnpaidBills, NumUnapprovedSA, OtherExperts, NumScannedFeeSchedule,
BillingAlert, BillingCC, AwaitingRetainer, AwaitingMaterial, SSMA_TimeStamp

### tblExpenses  ← the module in scope
ExpID (PK), ExpCaseID, ExpBillID, ExpDate, ExpDscr, ExpCheckNum, ExpType,
ExpBranch, ExpAmount, ExpReason, ExpInit, ExpClearedBank, ExpDateCleared,
ExpBankAccount, ExpClearingNotes, Exp_scanned_check_number,
Exp_NotCountedInProfit, SSMA_TimeStamp

`Expenses.docx` lists only 9 of these 18 (ExpID, ExpCaseID, ExpDate, ExpDscr,
ExpCheckNum, ExpType, ExpAmount, ExpReason, Exp_NotCountedInProfit) and marks
`Initials` (= ExpInit) as probably droppable. Unresolved: whether the bank
reconciliation columns (ExpClearedBank / ExpDateCleared / ExpBankAccount /
ExpClearingNotes / Exp_scanned_check_number), ExpBillID, and ExpBranch are
dropped or just out of scope for the entry form. The Access front-end has a
`ClearedExpensesAndIncome` form, so reconciliation is live functionality.

### tblExpType (lookup: ExpTypeID, ExpType, Active)
Bonus/Donation, Case Material, DO NOT USE INS/IRA (Pre 2009), License/Dues,
Meals, Misc, New Office Equip (>$1K/depreciated), NonTech Office Supplies
(<$1K/general office supplies), Travel/Lodging, Phone/Web, Prof. Serv, Rent,
Repair & Maint., Staff Salary, Void, Consultants, FICA (Employer Tax),
Additional Tax, Case Refund, Lodging, Tech Office Supplies (purchased for
specific job / no lasting value), Partner Salary, Lease, Tech Insurance,
Pre-2013 Health Ins. (Baker), Pre 2013 Health/Life Ins. (Ojalvo), Pre-2013
Health/Life Ins. (Seluga), Auto Insurance, IRA {Baker,Ojalvo,Seluga} Company
Match IRA, Health Ins / Disability / Life Ins × {Baker, Seluga, Ojalvo}

Note the `Active` flag and the "DO NOT USE" / "Pre-2013" entries — types are
soft-retired, never deleted. Any new UI must preserve that.

### tblBills
BillID, BillCaseID, BillDate, BillHours, BillBalance, BillReports, BillFileName,
BillNotice, BillPaidDate, BillSecondNoticeDate, BillFinalNoticeDate,
BillEstimate, BillPriority, BillComments

### tblFundsRcvd (income)
FndsID, FndsCaseID, FndsDate, FndsPmt, FndsPayee, FndsSource, FndsDesc,
FndsBranch, FndsSAFileName, FndsBillFileName, FndsComment, FndsType,
FndsClearedBank, FndsDateCleared, FndsBankAccount, FndsClearingNotes

### tblFirm
FrmID, FrmName, FrmAddress1, FrmAddress2, FrmCity, FrmState, FrmZip, FrmPhone,
FrmFax, FrmEmail, FrmPracticeType, FrmSize, FrmActive

### tblAttorney
AttyID, AttyFirmID, AttyTitle, AttyFirstName, AttyMiddleName, AttyLastName,
AttySuffix, AttyEsq, AttyPhone, AttyEmail, AttyCellPhone

### tblClient
ClientID, ClientTitle, ClientFirstName, ClientLastName, ClientPhone, ClientNotes

### tblInquiry
InquiryID, InqDate, InqTime, InqAttyID, InqSubject, InqLocation, InqRefferredBy,
InqResultingCase, InqCallerTitle, InqCallerName, InqAttyName, InqFirm,
InqFirmLocation, InqAccidentLocation, InqDescription, InqHowHeardAboutUs,
InqClient, InqPhoneNumber, InqAltPhoneNumber, InqFaxNumber, InqEmail,
InqPreviousCase, InqReceptionist, InqEngineer, InqCaption

### tblSrvAuth (service authorizations)
SrvAuthCaseID, SrvAuthDate, SrvAuthHours, SrvAuthFile, SrvAuthStatus,
SrvDateApproved, SrvAdvance, SrvAuthNotes

### tblActivity (time entry)
ActID, ActCaseID, ActDate, ActDescription, ActHrs, ActWho, ActBilled

### tblBillingNames
PersonID, Initials, BillingFactor

### tblCaseResult
RsltID, RsltCaseID, RsltDate, RsltType, RsltSatisfaction

### tbl_ScannedBillAndCheck
ID_number, Check_number, Check_date, Description, Long_description,
Scan_filename

### Lookups / misc
tblStates (State), tblBranches (Branch), tblCaseStatus (CaseStatus),
tblCasePriority (Priority), tblCaseWaitingFor (WaitingFor), tblActive,
TblScannedDocument, viewCaseSearch, localReleaseNotes (ReleaseNote)

## Notable front-end objects (what the app has to replace eventually)

- Expenses: frmExpenseEntry, frmExpenseEdit, frmExpenseView, frmExpenseCase,
  frmExpenseByMonth, frmYearlyExpense, frmExpenseReport, ClearedExpensesAndIncome
- Billing: frmCaseBill, frmBillPaid, frmBillUnpaid, frmBillDeadbeat, frmCaseServAuth
- Cases/CRM: CaseSearch, frmCaseAdd/Update/Activity, frmWaitingFor, Work Status Sheet
- Analysis queries: Analysis_Income_By_Firm, Analysis_cases_by_firm,
  qryLastThreeYearsIncomeByCase, xtabExpenses, qryForCheckbookComparison*

## Security flag (act on this)

`BackupLocal.bat` / `BackupRemote.bat` contain the **plaintext SQL Server
password** for the `TechAssoc` login, and they were transferred through the same
S3 bucket the docs came from. That credential should be rotated and the scripts
switched to an env var / credential file before anything else ships.

---

# Addendum — business logic and external dependencies

Extracted from VBA strings in the `.accdb`. This is the part that does NOT
migrate by moving tables, and it is the real cost driver of a replacement.

## Billing is driven by Excel timesheets, not by tblActivity

Bills are generated by reading **per-person Excel timesheets on a NAS share**
(`NAS_TA_TimeSheets`), not from `tblActivity`. VBA comments:

- `Get unbilled work and rate from timesheet(KJS)`
- `For given case, return it's rate and unbilled items from KJS's time sheet`
- `Timesheet (and hourly rate) not found for case # ...`
- Timesheet column contract: `[Date, Task, Dec, Sub, Fee($), Billed]` (1-based)

So "easier time tracking" = replacing this Excel-on-a-NAS workflow. It is also
the *hardest* piece, because bill generation is coupled to that sheet layout.
`tblActivity` (ActDate/ActHrs/ActWho/ActBilled) exists but is not the billing
source of truth — confirm with Kris whether it is used at all.

## Rate logic (hardcoded, manually edited each year)

- `TwoYearRateUpdate`, `testimonyRate`
- `Update rates if last task is older that 2 yrs after case started`
- `Update rates for today's date (ok if it overides above rate update)`
- `Update rates if given billing date is 2 years after case started`
- `*** THIS IS 2026, AND MUST BE UPDATED WHEN RATES ARE UPDATED IN FUTURE`

Rates live **in VBA source**, are versioned by year, and escalate when a case
passes two years from start. In the new system this becomes a `rates` table with
effective-date ranges. Need the current + historical rate cards from Kris —
re-billing an old case must reproduce the rate that applied then.

`tblBillingNames.BillingFactor * ActHrs` — per-person billing multiplier.

## Bill types (frmCaseBill buttons)

BILL_BLANK, BILL_TIMESHEET, BILL_DEPOPREP, BILL_DEPO, BILL_TRIAL, BILL_RETAINER.
Each pulls a different subset of rates/unbilled work. Bills are rendered through
**Word automation** and emailed through **Thunderbird** (`cmdEmailBill_Click`).

## External file dependencies (all on-premise, all must be replaced or re-hosted)

| Path | Used for |
| --- | --- |
| `NAS_TA_TimeSheets` | per-person Excel timesheets, billing source |
| `\\192.168.254.25\TECH_ASSOC_DOCUMENTS\` | case documents |
| `\\Tech02\NETWORK_SCANS`, `c:\scan\` | scanner drop folders (bills, checks, inquiries) |
| `C:\TECH05\tech_assoc_database\` | DB + backup working dir |
| `This_Is_Front_Desk.txt` | machine-role flag file, gates front-desk-only behavior |
| Thunderbird | sending bills |
| Word / Excel automation | generating bills and reports |

The Access references target **Office 2007 (`Office12`)** with newer `Office16`
references layered in — the front end is ~2007-era and 32-bit.

## What this means for scope

Tables are the easy half. The hard half is: timesheet-driven billing with
date-effective rate escalation, Word/Thunderbird bill delivery, and four network
shares of loose files.
