// One invented row per table, in FK-safe insert order. Typed against the
// generated Database (lib/db/types.ts) so a schema drift fails typecheck.
// Never real client, attorney, or check data.
import type { Database } from "../../../lib/db/types";

type Insert<T extends keyof Database["public"]["Tables"]> = Database["public"]["Tables"][T]["Insert"];
type Row = { [T in keyof Database["public"]["Tables"]]: [T, Insert<T>] }[keyof Database["public"]["Tables"]];

export const CASE_ID = 90001;
export const rows: Row[] = [
  ["tblstates", { state: "CT" }],
  ["tblbranches", { branch: "Hartford" }],
  ["tblcasestatus", { casestatus: "Active" }],
  ["tblcasepriority", { priority: "High" }],
  ["tblcasewaitingfor", { waitingfor: "Retainer" }],
  ["tblbillingnames", { personid: 1, initials: "KJS", billingfactor: 1.0 }],
  ["tblbillingnames", { personid: 2, initials: "JON", billingfactor: 0.75 }],
  ["tblexptype", { exptypeid: 1, exptype: "Case Material", active: true }],
  ["tblexptype", { exptypeid: 2, exptype: "DO NOT USE INS/IRA (Pre 2009)", active: false }],
  ["tblfirm", { frmid: 1, frmname: "Example & Partners LLP", frmstate: "CT", frmactive: "Yes" }],
  ["tblattorney", { attyid: 1, attyfirmid: 1, attyfirstname: "Pat", attylastname: "Example", attyesq: true }],
  ["tblclient", { clientid: 1, clientfirstname: "Sam", clientlastname: "Sample" }],
  ["tblinquiry", { id: 1, inqdate: "2026-01-05", inqtime: "09:30", inqattyid: 1, inqsubject: "Slip and fall", inqreceptionist: "RM", inqengineer: "KJS" }],
  ["tblcase", { caseid: CASE_ID, caseatty: 1, casetitle: "Sample v. Example", caseclient: 1, tabranch: "Hartford", status: "Active", casestartdate: "2026-01-10", casestatpriority: "High", casestatwaitingfor: "Retainer", caseinquiry: 1, numunpaidbills: 1, billingalert: false }],
  ["tblbills", { billid: 1, billcaseid: CASE_ID, billdate: "2026-02-01", billhours: 3.5, billbalance: 875.0, billnotice: "First", billestimate: false }],
  // Bill 1 is legacy (no billtype, no lines); bill 2 is a finalized, paid timesheet bill that owns the line.
  ["tblbills", { billid: 2, billcaseid: CASE_ID, billdate: "2026-03-01", billhours: 2.0, billbalance: 500.0, billnotice: "Paid", billestimate: false, billtype: "timesheet", billfinalizedat: "2026-03-01T12:00:00Z" }],
  ["tblbilllines", { billid: 2, lineno: 1, kind: "charge", linedate: "2026-01-15", description: "Site inspection", personid: 1, hours: 2.0, rate: 250.0, amount: 500.0 }],
  ["tblactivity", { actid: 1, actcaseid: CASE_ID, actdate: "2026-01-15", actdescription: "Site inspection", acthrs: 2.0, actwho: 1, actbilled: false }],
  ["tblactivity", { actid: 2, actcaseid: CASE_ID, actdate: "2026-01-16", actdescription: "Photo review", acthrs: 1.5, actwho: 2, actbilled: true }],
  ["tblexpenses", { expid: 1, expcaseid: CASE_ID, expbillid: 1, expdate: "2026-01-20", expdscr: "Photo prints", expchecknum: 1001, exptype: 1, expamount: 42.5, expinit: 1, expclearedbank: false, exp_notcountedinprofit: 0 }],
  ["tblfundsrcvd", { fndsid: 1, fndscaseid: CASE_ID, fndsdate: "2026-02-15", fndspmt: 500.0, fndspayee: "Example & Partners LLP", fndsbranch: "Hartford", fndsclearedbank: false }],
  ["tblsrvauth", { srvauthid: 1, srvauthcaseid: CASE_ID, srvauthdate: "2026-01-12", srvauthhours: 10.0, srvauthstatus: "Approved" }],
  ["tblcaseresult", { rsltid: 1, rsltcaseid: CASE_ID, rsltdate: "2026-06-01", rslttype: "Settled" }],
  ["tbl_scannedbillandcheck", { id_number: 1, check_number: 1001, check_date: "2026-01-20", description: "Photo prints", scan_filename: "scan-0001.pdf" }],
  ["tblscanneddocument", { id: 1, caseid: CASE_ID, expenseid: 1, dateadded: "2026-01-21", type: "Receipt", filename: "scan-0001.pdf" }],
  ["bank_transactions", { bankaccount: "OperatingChecking", postedon: "2026-01-22", amount: 42.5, description: "Photo prints reimbursement", expid: 1 }],
];
