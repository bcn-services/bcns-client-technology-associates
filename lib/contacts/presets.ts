/**
 * The five legacy contact presets, ported from the Access stored queries
 * (read from MSysQueries in DB_Technology_Associates.accdb; every join is INNER):
 *   active-firms   qryActiveFirms    firm ⋈ attorney WHERE FrmActive = [IsActive]        (no ORDER BY in legacy)
 *   duplicates     qryFindDupAttys   firm ⋈ attorney ORDER BY AttyLastName, AttyFirmID
 *   rename         qryFirmNameChange firm ⋈ attorney ORDER BY FrmName
 *   attorney-ids   qryUpdateAttyID   attorney ⋈ case ORDER BY CaseAtty
 *   by-state       qryByState        firm ⋈ attorney ⋈ case WHERE FrmState = [State Abbrv] (no ORDER BY in legacy)
 * Comparisons are case-insensitive (Access/SQL Server CI collation). Sorts are
 * case-insensitive, nulls first (SQL Server), with primary keys appended as tiebreakers;
 * the two unordered legacy queries get a fixed order (firm name / case #) so results are stable.
 */
import { fetchAll, eqi, type Db, type Row } from "./contacts";

export type PresetName = "active-firms" | "duplicates" | "rename" | "attorney-ids" | "by-state";
export type Tables = { firms: Row[]; attys: Row[]; cases: Row[] };
type Col = { key: string; label: string };
export type Preset = { name: PresetName; title: string; param?: string; cols: Col[]; run: (t: Tables, value: string) => Row[] };

const FIRM_COLS = "frmid, frmname, frmaddress1, frmaddress2, frmcity, frmstate, frmzip, frmphone, frmactive";
const ATTY_COLS = "attyid, attyfirmid, attytitle, attyfirstname, attymiddlename, attylastname, attysuffix, attyesq, attyphone";

/** SQL Server ascending order: nulls first, case-insensitive text. */
function cmp(a: unknown, b: unknown): number {
  if (a == null || b == null) return a == null ? (b == null ? 0 : -1) : 1;
  if (typeof a === "number" && typeof b === "number") return a - b;
  const x = String(a).toLowerCase(), y = String(b).toLowerCase();
  return x < y ? -1 : x > y ? 1 : 0;
}
const orderBy = (rows: Row[], keys: string[]) =>
  rows.sort((r, s) => { for (const k of keys) { const c = cmp(r[k], s[k]); if (c) return c; } return 0; });

function firmAttys(t: Tables): Row[] {
  const firms = new Map(t.firms.map((f) => [f.frmid, f]));
  return t.attys.flatMap((a) => { const f = firms.get(a.attyfirmid); return f ? [{ ...f, ...a }] : []; });
}
function attyCases(t: Tables, rows: Row[]): Row[] {
  const byId = new Map(rows.map((a) => [a.attyid, a]));
  return t.cases.flatMap((c) => { const a = byId.get(c.caseatty); return a ? [{ ...a, ...c }] : []; });
}
const pick = (rows: Row[], cols: Col[], extra: string[]) =>
  rows.map((r) => Object.fromEntries([...cols.map((c) => c.key), ...extra].map((k) => [k, r[k] ?? null])) as Row);

const ADDRESS: Col[] = [
  { key: "frmaddress1", label: "Address 1" }, { key: "frmaddress2", label: "Address 2" },
  { key: "frmcity", label: "City" }, { key: "frmstate", label: "State" }, { key: "frmzip", label: "Zip" },
];

export const PRESETS: Record<PresetName, Preset> = {
  "active-firms": {
    name: "active-firms", title: "Active firms", param: "Active value",
    cols: [{ key: "frmactive", label: "Active" }, { key: "attyfirstname", label: "First" }, { key: "attylastname", label: "Last" }, { key: "frmname", label: "Firm" }, ...ADDRESS],
    // frmactive is text: match the stored value case-insensitively, never as a boolean.
    run(t, value) {
      const rows = firmAttys(t).filter((r) => eqi(r.frmactive, value));
      return pick(orderBy(rows, ["frmname", "frmid", "attyid"]), this.cols, ["frmid", "attyid"]);
    },
  },
  duplicates: {
    name: "duplicates", title: "Attorneys by last name (duplicate worksheet)",
    cols: [{ key: "attyid", label: "Atty ID" }, { key: "attyfirstname", label: "First" }, { key: "attylastname", label: "Last" }, { key: "attyfirmid", label: "Firm ID" }, { key: "frmname", label: "Firm" }, ...ADDRESS, { key: "frmphone", label: "Phone" }],
    run(t) { return pick(orderBy(firmAttys(t), ["attylastname", "attyfirmid", "attyid"]), this.cols, ["frmid"]); },
  },
  rename: {
    name: "rename", title: "Firms by name (rename list)",
    cols: [{ key: "frmname", label: "Firm" }, { key: "attyname", label: "Attorney" }, { key: "attyid", label: "Atty ID" }, { key: "frmphone", label: "Firm Phone" }, { key: "attyphone", label: "Atty Phone" }, { key: "attyfirmid", label: "Firm ID" }, { key: "frmaddress1", label: "Address 1" }, { key: "frmaddress2", label: "Address 2" }, { key: "frmzip", label: "Zip" }],
    run(t) {
      // Access `&` treats null as empty.
      const rows = firmAttys(t).map((r) => ({ ...r, attyname: `${r.attyfirstname ?? ""} ${r.attylastname ?? ""}` }));
      return pick(orderBy(rows, ["frmname", "frmid", "attyid"]), this.cols, ["frmid"]);
    },
  },
  "attorney-ids": {
    name: "attorney-ids", title: "Attorneys with their cases (attorney-ID fix list)",
    cols: [{ key: "attylastname", label: "Last" }, { key: "caseid", label: "Case #" }, { key: "caseatty", label: "Case Atty" }, { key: "attyfirmid", label: "Firm ID" }, { key: "attytitle", label: "Title" }, { key: "attyfirstname", label: "First" }, { key: "attymiddlename", label: "Middle" }, { key: "attysuffix", label: "Suffix" }, { key: "attyesq", label: "Esq." }],
    run(t) { return pick(orderBy(attyCases(t, t.attys), ["caseatty", "caseid"]), this.cols, ["attyid"]); },
  },
  "by-state": {
    name: "by-state", title: "Cases by firm state", param: "State",
    cols: [{ key: "caseid", label: "Case #" }, { key: "casetitle", label: "Title" }, { key: "frmstate", label: "State" }],
    run(t, value) {
      const rows = attyCases(t, firmAttys(t)).filter((r) => eqi(r.frmstate, value) && value !== "");
      return pick(orderBy(rows, ["caseid"]), this.cols, []);
    },
  },
};

/** Reads only the tables the preset joins, then runs it. */
// ponytail: whole-table reads joined in JS (no views/RPCs — migrations are protected); move to a view if tblcase outgrows ~50k rows.
export async function runPreset(db: Db, name: PresetName, value = ""): Promise<Row[]> {
  const p = PRESETS[name];
  const needsCases = name === "attorney-ids" || name === "by-state";
  const needsFirms = name !== "attorney-ids";
  const [firms, attys, cases] = await Promise.all([
    needsFirms ? fetchAll(db, "tblfirm", FIRM_COLS, "frmid") : Promise.resolve([]),
    fetchAll(db, "tblattorney", ATTY_COLS, "attyid"),
    needsCases ? fetchAll(db, "tblcase", "caseid, casetitle, caseatty", "caseid") : Promise.resolve([]),
  ]);
  return p.run({ firms, attys, cases }, value);
}
