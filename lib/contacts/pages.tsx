/** Shared server-rendered list and edit screens for /firms, /attorneys, /clients. */
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireSession } from "@/lib/auth/session";
import { createServerClient } from "@/lib/db/client";
import { safeReturnTo } from "@/lib/cases/create";
import { saveContact } from "./actions";
import { SPECS, eqi, fetchAll, formOptions, loadAttorneyWithFirm, loadContact, type Db, type Field, type Kind, type Row } from "./contacts";

const input = "rounded border border-slate-300 px-2 py-1";
const byName = (...keys: string[]) => (a: Row, b: Row) => {
  for (const k of keys) {
    const c = String(a[k] ?? "").toLowerCase().localeCompare(String(b[k] ?? "").toLowerCase());
    if (c) return c;
  }
  return 0;
};

type Options = Awaited<ReturnType<typeof formOptions>>;

/** Keeps a stored value that is off-list (or differs only in case) so an untouched save writes nothing. */
function listOptions(list: string[], current: unknown): string[] {
  const cur = current == null ? "" : String(current);
  const out = list.map((o) => (cur && eqi(o, cur) ? cur : o));
  return cur && !out.includes(cur) ? [cur, ...out] : out;
}

function FieldInput({ f, row, options }: { f: Field; row: Row | null; options: Options }) {
  const value = row?.[f.col];
  const str = value == null ? "" : String(value);
  const id = `f-${f.col}`;
  if (f.type === "checkbox") {
    return (
      <label htmlFor={id} className="flex items-center gap-2 text-sm">
        <input id={id} name={f.col} type="checkbox" defaultChecked={value === true} /> {f.label}
      </label>
    );
  }
  let control;
  if (f.type === "textarea") control = <textarea id={id} name={f.col} defaultValue={str} rows={4} className={input} />;
  else if (f.type === "state" || f.type === "list") {
    const opts = listOptions(f.type === "state" ? options.states : f.options ?? [], value);
    control = (
      <select id={id} name={f.col} defaultValue={str} className={input}>
        <option value="" />
        {opts.map((o) => <option key={o} value={o}>{o}</option>)}
      </select>
    );
  } else if (f.type === "firm") {
    control = (
      <select id={id} name={f.col} defaultValue={str} required className={input}>
        <option value="" />
        {options.firms.map((o) => <option key={String(o.frmid)} value={String(o.frmid)}>{String(o.frmname)}</option>)}
      </select>
    );
  } else if (f.type === "active") {
    // Picks from the values already stored (text, not boolean); an off-list current value stays selectable.
    control = (
      <select id={id} name={f.col} defaultValue={str} required className={input}>
        <option value="" />
        {listOptions(options.activeValues, value).map((o) => <option key={o} value={o}>{o}</option>)}
      </select>
    );
  } else control = <input id={id} name={f.col} defaultValue={str} required={f.required} className={input} />;
  return (
    <label htmlFor={id} className="grid gap-1 text-sm">
      {f.label}
      {control}
    </label>
  );
}

export async function ContactEditPage({ kind, idParam, flash }: { kind: Kind; idParam: string; flash: { saved?: string; error?: string; returnTo?: string } }) {
  await requireSession();
  const spec = SPECS[kind];
  const id = idParam === "new" ? null : Number(idParam);
  if (id !== null && !Number.isInteger(id)) notFound();
  const db = createServerClient() as unknown as Db;
  const [loaded, options] = await Promise.all([
    id === null ? null : kind === "attorney" ? loadAttorneyWithFirm(db, id) : loadContact(db, kind, id).then((row) => row && { atty: row, firm: null }),
    formOptions(db, kind),
  ]);
  if (id !== null && !loaded) notFound();
  const row = loaded?.atty ?? null;
  const firm = loaded?.firm ?? null;
  const cancelTo = id === null ? safeReturnTo(flash.returnTo) : null;

  return (
    <main className="mx-auto max-w-3xl space-y-4 px-4 py-6">
      <p className="text-sm"><Link href={spec.path} className="text-slate-600 underline">All {spec.path.slice(1)}</Link></p>
      <h1 className="text-xl font-semibold">{id === null ? `New ${spec.title.toLowerCase()}` : `${spec.title} ${id}`}</h1>
      {kind === "attorney" && row && (
        <p data-testid="attorney-firm" className="text-sm">
          Firm: {firm ? <Link href={`/firms/${String(firm.frmid)}`} className="underline">{String(firm.frmname)}</Link> : <span className="text-slate-500">(missing firm {String(row.attyfirmid)})</span>}
        </p>
      )}
      {flash.saved && <p role="status" className="text-sm text-emerald-700">{flash.saved === "created" ? `${spec.title} created` : `${spec.title} saved`}</p>}
      {flash.error && <p role="alert" className="text-sm text-red-700">{flash.error}</p>}
      <form action={saveContact.bind(null, kind, id)} className="grid gap-3 sm:grid-cols-2">
        {id === null && flash.returnTo && <input type="hidden" name="returnTo" value={flash.returnTo} />}
        {row && <input type="hidden" name="__orig" value={JSON.stringify(row)} />}
        {spec.fields.map((f) => <FieldInput key={f.col} f={f} row={row} options={options} />)}
        <div className="flex items-center gap-4 sm:col-span-2">
          <button type="submit" className="rounded border border-slate-300 px-3 py-1 hover:bg-slate-100">Save</button>
          {cancelTo && <Link href={cancelTo} className="text-sm text-slate-600 underline">Cancel</Link>}
        </div>
      </form>
    </main>
  );
}

export async function ContactListPage({ kind }: { kind: Kind }) {
  await requireSession();
  const spec = SPECS[kind];
  const db = createServerClient() as unknown as Db;
  let cols: { key: string; label: string }[];
  let rows: Row[];
  if (kind === "firm") {
    rows = (await fetchAll(db, "tblfirm", "frmid, frmname, frmcity, frmstate, frmphone, frmactive", "frmid")).sort(byName("frmname"));
    cols = [{ key: "frmname", label: "Firm Name" }, { key: "frmcity", label: "City" }, { key: "frmstate", label: "State" }, { key: "frmphone", label: "Phone" }, { key: "frmactive", label: "Active" }];
  } else if (kind === "attorney") {
    const [attys, firms] = await Promise.all([
      fetchAll(db, "tblattorney", "attyid, attyfirstname, attylastname, attyfirmid, attyphone", "attyid"),
      fetchAll(db, "tblfirm", "frmid, frmname", "frmid"),
    ]);
    const names = new Map(firms.map((f) => [f.frmid, f.frmname]));
    rows = attys.map((a) => ({ ...a, frmname: names.get(a.attyfirmid) ?? null })).sort(byName("attylastname", "attyfirstname"));
    cols = [{ key: "attylastname", label: "Last Name" }, { key: "attyfirstname", label: "First Name" }, { key: "frmname", label: "Firm" }, { key: "attyphone", label: "Phone" }];
  } else {
    rows = (await fetchAll(db, "tblclient", "clientid, clienttitle, clientfirstname, clientlastname, clientphone", "clientid")).sort(byName("clientlastname", "clientfirstname"));
    cols = [{ key: "clientlastname", label: "Last Name" }, { key: "clientfirstname", label: "First Name" }, { key: "clienttitle", label: "Title" }, { key: "clientphone", label: "Phone" }];
  }
  // ponytail: whole list on one page; add paging/search when it gets slow to scan.
  return (
    <main className="mx-auto max-w-6xl space-y-4 px-4 py-6">
      <div className="flex flex-wrap items-center gap-4">
        <h1 className="text-xl font-semibold">{spec.title}s</h1>
        <Link href={`${spec.path}/new`} className="rounded border border-slate-300 px-3 py-1 text-sm hover:bg-slate-100">New {spec.title.toLowerCase()}</Link>
        {kind !== "client" && <Link href="/attorneys/lists" className="text-sm underline">Contact lists</Link>}
      </div>
      <table className="w-full text-left text-sm">
        <thead className="border-b border-slate-200 text-slate-600">
          <tr>{cols.map((c) => <th key={c.key} className="py-2">{c.label}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={String(r[spec.id])} className="border-b border-slate-100">
              {cols.map((c, i) => (
                <td key={c.key} className="py-1">
                  {i === 0 ? <Link href={`${spec.path}/${String(r[spec.id])}`} className="underline">{String(r[c.key] ?? "") || "(blank)"}</Link> : String(r[c.key] ?? "")}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </main>
  );
}
