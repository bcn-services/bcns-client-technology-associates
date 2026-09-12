// Invented seed set for the contact presets: mixed-case names/values, a firm with no
// attorneys, an attorney whose firm is missing, a case whose attorney is missing,
// and ids deliberately out of every legacy sort order.
export const states = ["CT", "NY"];
export const firms = [
  { frmid: 1, frmname: "Example & Partners LLP", frmstate: "CT", frmactive: "Yes", frmphone: "555-0101" },
  { frmid: 2, frmname: "alpha law", frmstate: "NY", frmactive: "YES", frmaddress1: "1 Main St" },
  { frmid: 3, frmname: "Beta Group", frmstate: "ct", frmactive: "No" },
  { frmid: 4, frmname: "Zeta LLC", frmstate: null, frmactive: "True" },
  { frmid: 5, frmname: "Gamma", frmstate: "NY", frmactive: "-1" },
  { frmid: 6, frmname: "beta group", frmstate: "NY", frmactive: "yes", frmzip: "10001" },
  { frmid: 7, frmname: "Delta", frmstate: "CT", frmactive: "Yes" },
];
export const attys = [
  { attyid: 1, attyfirmid: 1, attyfirstname: "Pat", attylastname: "Example", attyesq: true },
  { attyid: 2, attyfirmid: 2, attyfirstname: "Ann", attylastname: "Zimmer", attyesq: false },
  { attyid: 3, attyfirmid: 3, attyfirstname: "bob", attylastname: "adams", attyesq: false },
  { attyid: 4, attyfirmid: 4, attyfirstname: "Cy", attylastname: "Adams", attyesq: false, attymiddlename: "Q" },
  { attyid: 5, attyfirmid: 5, attyfirstname: "Di", attylastname: "Moore", attyesq: true },
  { attyid: 6, attyfirmid: 6, attyfirstname: "Ed", attylastname: "Brown", attyesq: false },
  { attyid: 7, attyfirmid: 1, attyfirstname: "Flo", attylastname: "Adams", attyesq: false, attysuffix: "Jr." },
  { attyid: 8, attyfirmid: 99, attyfirstname: "Orphan", attylastname: "Nofirm", attyesq: false }, // firm 99 missing
];
export const cases = [
  { caseid: 90001, caseatty: 1, casetitle: "Sample v. Example" },
  { caseid: 100, caseatty: 5, casetitle: "Moore case" },
  { caseid: 101, caseatty: 3, casetitle: "Adams matter" },
  { caseid: 102, caseatty: 1, casetitle: "Another Example" },
  { caseid: 103, caseatty: 8, casetitle: "Orphan firm case" },
  { caseid: 104, caseatty: 999, casetitle: "No attorney" }, // attorney 999 missing
  { caseid: 105, caseatty: 2, casetitle: "Apple v. Two" },
  { caseid: 99, caseatty: 6, casetitle: "Zed v. Six" },
];

/** Fill every selected column (null when absent), as PostgREST would return them. */
const FIRM_COLS = ["frmid", "frmname", "frmaddress1", "frmaddress2", "frmcity", "frmstate", "frmzip", "frmphone", "frmactive"];
const ATTY_COLS = ["attyid", "attyfirmid", "attytitle", "attyfirstname", "attymiddlename", "attylastname", "attysuffix", "attyesq", "attyphone"];
const full = (rows, cols) => rows.map((r) => Object.fromEntries(cols.map((c) => [c, r[c] ?? null])));
export const tables = () => ({ firms: full(firms, FIRM_COLS), attys: full(attys, ATTY_COLS), cases: cases.map((c) => ({ ...c })) });
