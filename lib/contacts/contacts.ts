/**
 * Firms, attorneys, clients — field specs per the legacy frmAddFirm/frmEditFirm,
 * frmAddAtty/frmEditAtty, frmEditClient forms, plus create / edit / load.
 * The DB client is injected. There is deliberately no delete here (lane rule).
 */

/** Structural slice of the Supabase client this module uses (method syntax keeps it assignable). */
export interface Db {
  from(table: string): any;
}

export type Kind = "firm" | "attorney" | "client";
export type FieldType = "text" | "textarea" | "checkbox" | "state" | "firm" | "list" | "active";
export type Field = { col: string; label: string; type?: FieldType; required?: boolean; options?: string[] };
export type Spec = { table: string; id: string; path: string; title: string; fields: Field[] };
export type Row = Record<string, string | number | boolean | null>;

export const SPECS: Record<Kind, Spec> = {
  firm: {
    table: "tblfirm", id: "frmid", path: "/firms", title: "Firm",
    fields: [
      { col: "frmname", label: "Firm Name", required: true },
      { col: "frmaddress1", label: "Address 1" },
      { col: "frmaddress2", label: "Address 2" },
      { col: "frmcity", label: "City" },
      { col: "frmstate", label: "State", type: "state" },
      { col: "frmzip", label: "Zip" },
      { col: "frmphone", label: "Phone" },
      { col: "frmfax", label: "Fax" },
      { col: "frmemail", label: "Email" },
      // "Defendent" is the legacy spelling of the stored value — kept on purpose.
      { col: "frmpracticetype", label: "Practice Type", type: "list", options: ["Plaintiff", "Defendent", "NA"] },
      { col: "frmsize", label: "Size", type: "list", options: ["Small", "Medium", "Large"] },
      // Text, stored as-is; never coerced to a boolean.
      { col: "frmactive", label: "Active", type: "active", required: true },
    ],
  },
  attorney: {
    table: "tblattorney", id: "attyid", path: "/attorneys", title: "Attorney",
    fields: [
      { col: "attytitle", label: "Title" },
      { col: "attyfirstname", label: "First Name", required: true },
      { col: "attymiddlename", label: "Middle Name" },
      { col: "attylastname", label: "Last Name", required: true },
      { col: "attysuffix", label: "Suffix" },
      { col: "attyesq", label: "Esq.", type: "checkbox" },
      { col: "attyfirmid", label: "Firm", type: "firm", required: true },
      { col: "attyphone", label: "Phone" },
      { col: "attyemail", label: "Email" },
      { col: "attycellphone", label: "Cell" },
    ],
  },
  client: {
    table: "tblclient", id: "clientid", path: "/clients", title: "Client",
    fields: [
      { col: "clienttitle", label: "Title" },
      { col: "clientfirstname", label: "First Name" },
      { col: "clientlastname", label: "Last Name" },
      { col: "clientphone", label: "Phone" },
      { col: "clientnotes", label: "Notes", type: "textarea" },
    ],
  },
};

export const eqi = (a: unknown, b: unknown) => String(a ?? "").toLowerCase() === String(b ?? "").toLowerCase();
const blankToNull = (v: unknown) => (v === "" || v === undefined ? null : v);

export class ContactInputError extends Error {}

/** FormData → full column payload for `kind`. Blank text is null; the checkbox is presence. */
export function parseForm(kind: Kind, form: FormData): Row {
  const out: Row = {};
  for (const f of SPECS[kind].fields) {
    if (f.type === "checkbox") { out[f.col] = form.has(f.col); continue; }
    const raw = form.get(f.col);
    const v = typeof raw === "string" && raw !== "" ? raw : null;
    if (f.required && (v === null || v.trim() === "")) throw new ContactInputError(`${f.label} is required`);
    if (f.type === "firm") {
      const n = Number(v);
      if (!Number.isInteger(n)) throw new ContactInputError(`${f.label} is required`);
      out[f.col] = n;
    } else out[f.col] = v;
  }
  return out;
}

/** Only the columns whose value changed ("" and null are the same blank). */
export function changedColumns(current: Row, next: Row): Row {
  const out: Row = {};
  for (const [k, v] of Object.entries(next)) if (blankToNull(current[k]) !== blankToNull(v)) out[k] = v;
  return out;
}

export async function createContact(db: Db, kind: Kind, payload: Row): Promise<number> {
  const s = SPECS[kind];
  const { data, error } = await db.from(s.table).insert(payload).select(s.id).single();
  if (error) throw new Error(`${s.table} insert: ${error.message}`);
  return data[s.id];
}

export async function loadContact(db: Db, kind: Kind, id: number): Promise<Row | null> {
  const s = SPECS[kind];
  const { data, error } = await db.from(s.table).select("*").eq(s.id, id).maybeSingle();
  if (error) throw new Error(`${s.table} read: ${error.message}`);
  return data;
}

/** Writes only the changed columns; returns what was written ({} → no write at all). */
export async function updateContact(db: Db, kind: Kind, id: number, next: Row): Promise<Row> {
  const s = SPECS[kind];
  const current = await loadContact(db, kind, id);
  if (!current) throw new ContactInputError(`${s.title} ${id} not found`);
  const changes = changedColumns(current, next);
  if (Object.keys(changes).length === 0) return changes;
  const { error } = await db.from(s.table).update(changes).eq(s.id, id);
  if (error) throw new Error(`${s.table} update: ${error.message}`);
  return changes;
}

/** The attorney record with its firm row (null when the firm row is missing — NOT VALID FKs). */
export async function loadAttorneyWithFirm(db: Db, id: number) {
  const atty = await loadContact(db, "attorney", id);
  if (!atty) return null;
  const firm = await loadContact(db, "firm", Number(atty.attyfirmid));
  return { atty, firm };
}

// PostgREST caps a response at 1000 rows by default; page until a short page.
const PAGE = 1000;
export async function fetchAll(db: Db, table: string, cols: string, orderCol: string): Promise<Row[]> {
  const out: Row[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await db.from(table).select(cols).order(orderCol).range(from, from + PAGE - 1);
    if (error) throw new Error(`${table} read: ${error.message}`);
    out.push(...data);
    if (data.length < PAGE) return out;
  }
}

/** Lookup values the forms offer, read live. */
export async function formOptions(db: Db, kind: Kind) {
  if (kind === "firm") {
    const [states, actives] = await Promise.all([
      fetchAll(db, "tblstates", "state", "state"),
      fetchAll(db, "tblfirm", "frmid, frmactive", "frmid"),
    ]);
    const seen = new Map<string, string>();
    for (const r of actives) if (r.frmactive != null && !seen.has(String(r.frmactive).toLowerCase())) seen.set(String(r.frmactive).toLowerCase(), String(r.frmactive));
    return { states: states.map((r) => String(r.state)), activeValues: [...seen.values()].sort(), firms: [] as Row[] };
  }
  if (kind === "attorney") {
    // Legacy row source ~sq_cfrmEditAtty~sq_cAttyFirmID: FrmID, FrmName ORDER BY FrmName.
    const firms = await fetchAll(db, "tblfirm", "frmid, frmname", "frmid");
    firms.sort((a, b) => String(a.frmname).toLowerCase().localeCompare(String(b.frmname).toLowerCase()));
    return { states: [], activeValues: [], firms };
  }
  return { states: [], activeValues: [], firms: [] as Row[] };
}
