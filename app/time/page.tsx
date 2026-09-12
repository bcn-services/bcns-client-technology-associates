import { requireSession } from "@/lib/auth/session";
import { firmToday } from "@/lib/cases/presets";
import { NOT_LINKED, errorMessage } from "@/lib/time/entries";
import { EntryForm } from "./entry-form";
import { WeekSection } from "./week-view";

export const dynamic = "force-dynamic";

type Params = Record<string, string | string[] | undefined>;
const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

export default async function TimePage({ searchParams }: { searchParams: Params }) {
  const session = await requireSession();
  const error = first(searchParams.error);
  const values = {
    case: first(searchParams.case),
    date: first(searchParams.date) || firmToday(new Date()),
    hours: first(searchParams.hours),
    description: first(searchParams.description),
  };
  return (
    <main className="mx-auto max-w-4xl space-y-4 px-4 py-6">
      <h1 className="text-xl font-semibold">Time</h1>
      {session.personId == null ? (
        <p role="alert" className="text-sm text-amber-800">{NOT_LINKED}</p>
      ) : (
        <>
          {first(searchParams.added) === "1" && <p role="status" className="text-sm text-green-700">Entry added</p>}
          {first(searchParams.saved) === "1" && <p role="status" className="text-sm text-green-700">Entry saved</p>}
          {first(searchParams.deleted) === "1" && <p role="status" className="text-sm text-green-700">Entry deleted</p>}
          <EntryForm values={values} error={error ? errorMessage(error) : undefined} />
        </>
      )}
      <WeekSection session={session} week={first(searchParams.week)} who={first(searchParams.who)} />
    </main>
  );
}
