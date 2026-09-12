import Link from "next/link";
import { requireSession } from "@/lib/auth/session";
import { createServerClient } from "@/lib/db/client";
import { NOT_LINKED, errorMessage, isEditable, loadEntry, type Db } from "@/lib/time/entries";
import { deleteEntry, updateEntry } from "../actions";
import { EntryForm } from "../entry-form";

export const dynamic = "force-dynamic";

type Params = Record<string, string | string[] | undefined>;
const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

/** Edit/delete one time entry. Billed rows render read-only; staff see only their own rows. */
export default async function TimeEntryPage({ params, searchParams }: { params: { id: string }; searchParams: Params }) {
  const session = await requireSession();
  const error = first(searchParams.error);
  // A refused action lands here with ?error=; show it even when the row renders read-only or not at all.
  const shell = (body: React.ReactNode, showError = true) => (
    <main className="mx-auto max-w-4xl space-y-4 px-4 py-6">
      <p className="text-sm"><Link href="/time" className="text-slate-700 underline">← Time</Link></p>
      <h1 className="text-xl font-semibold">Time entry</h1>
      {showError && error && <p role="alert" className="text-sm text-red-700">{errorMessage(error)}</p>}
      {body}
    </main>
  );
  if (session.personId == null) return shell(<p role="alert" className="text-sm text-amber-800">{NOT_LINKED}</p>);
  const actid = /^\d{1,9}$/.test(params.id) ? Number(params.id) : 0;
  const row = actid ? await loadEntry(createServerClient() as unknown as Db, session, actid) : null;
  if (!row) return shell(<p role="alert" className="text-sm text-slate-700">Not found</p>);

  const orig = { case: String(row.actcaseid), date: row.actdate, hours: String(row.acthrs), description: row.actdescription };
  if (!isEditable(row)) {
    return shell(
      <>
        <p role="status" className="text-sm text-slate-700">{row.actbillid != null ? `Billed on bill ${row.actbillid}` : "Billed"}</p>
        <EntryForm values={orig} readOnly />
      </>,
    );
  }
  const values = error
    ? { case: first(searchParams.case), date: first(searchParams.date), hours: first(searchParams.hours), description: first(searchParams.description) }
    : orig;
  return shell(
    <>
      <EntryForm values={values} error={error ? errorMessage(error) : undefined} action={updateEntry.bind(null, row.actid)} submitLabel="Save" orig={orig} />
      <form action={deleteEntry.bind(null, row.actid)}>
        <button type="submit" className="rounded border border-red-300 px-3 py-1 text-sm text-red-700 hover:bg-red-50">Delete</button>
      </form>
    </>,
    false, // EntryForm renders the error itself
  );
}
