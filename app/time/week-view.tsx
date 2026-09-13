import Link from "next/link";
import type { Session } from "@/lib/auth/session";
import { createServerClient } from "@/lib/db/client";
import type { Db } from "@/lib/time/entries";
import { unbilledByCase, type UnbilledCase } from "@/lib/time/unbilled";
import { addDays, fmtHours, groupByDay, isBilled, listWeek, resolveWho, thousandths, weekBounds, type WeekRow } from "@/lib/time/week";

/** Loads and renders the week (plus admin extras). Read-only. `db` is injectable for tests. */
export async function WeekSection({ session, week, who: whoParam, db }: { session: Session; week?: string; who?: string; db?: Db }) {
  const d = db ?? (createServerClient() as unknown as Db);
  const admin = session.role === "admin";
  const who = resolveWho(session, whoParam);
  const { monday, sunday } = weekBounds(week);
  const soft = <T,>(p: Promise<T>) => p.catch((e) => (console.error(e), null));
  const [rows, unbilled, people] = await Promise.all([
    who == null ? Promise.resolve([] as WeekRow[]) : soft(listWeek(d, who, monday)),
    admin ? soft(unbilledByCase(d)) : Promise.resolve(null),
    admin
      ? d.from("tblbillingnames").select("personid, initials").order("initials").then((r: { data: unknown }) => r.data ?? [])
      : Promise.resolve([]),
  ]);
  return <WeekView monday={monday} sunday={sunday} rows={rows} admin={admin} who={who} people={people as WeekViewProps["people"]} unbilled={unbilled} />;
}

// Journey 03 trap: no <label>/aria-label matching /case|hours|description/i and no /save|add entry/i button here.

export type WeekViewProps = {
  monday: string;
  sunday: string;
  rows: WeekRow[] | null; // null = read failed
  admin: boolean;
  who: number | null;
  people?: { personid: number; initials: string }[];
  unbilled?: UnbilledCase[] | null;
};

const weekHref = (week: string, admin: boolean, who: number | null) =>
  `/time?week=${week}${admin && who != null ? `&who=${who}` : ""}`;

export function WeekView({ monday, sunday, rows, admin, who, people = [], unbilled }: WeekViewProps) {
  const { days, total } = groupByDay(rows ?? []);
  return (
    <section className="space-y-4">
      {admin && <UnbilledTable rows={unbilled ?? null} />}
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="text-lg font-semibold">
          Week of {monday} – {sunday}
        </h2>
        <Link className="text-sm underline" href={weekHref(addDays(monday, -7), admin, who)}>Previous week</Link>
        <Link className="text-sm underline" href={weekHref(addDays(monday, 7), admin, who)}>Next week</Link>
        {admin && (
          <form method="get" action="/time" className="flex items-center gap-2 text-sm">
            <input type="hidden" name="week" value={monday} />
            <label htmlFor="week-who">Person</label>
            <select id="week-who" name="who" defaultValue={who ?? ""} className="rounded border px-2 py-1">
              {people.map((p) => (
                <option key={p.personid} value={p.personid}>{p.initials}</option>
              ))}
            </select>
            <button type="submit" className="rounded border px-2 py-1">Show</button>
          </form>
        )}
      </div>
      {rows == null ? (
        <p className="text-sm text-red-700">Couldn&apos;t load this week. Try again.</p>
      ) : days.length === 0 ? (
        <p className="text-sm text-gray-600">No time logged this week.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm" data-testid="week-table">
            <thead>
              <tr className="text-left">
                <th>Date</th><th>Case</th><th>Description</th><th className="text-right">Hours</th><th />
              </tr>
            </thead>
            {days.map((d) => (
              <tbody key={d.date} className="border-t">
                {d.rows.map((r) => (
                  <tr key={r.actid}>
                    <td><Link className="underline" href={`/time/${r.actid}`}>{r.actdate}</Link></td>
                    <td>{r.actcaseid} {r.tblcase?.casetitle ?? ""}</td>
                    <td>{r.actdescription}</td>
                    <td className="text-right">{fmtHours(thousandths(r.acthrs))}</td>
                    <td>{isBilled(r) ? <span className="text-xs text-gray-600">billed</span> : null}</td>
                  </tr>
                ))}
                <tr className="font-medium" data-testid="day-total">
                  <td colSpan={3}>{d.date} total</td>
                  <td className="text-right">{d.total}</td>
                  <td />
                </tr>
              </tbody>
            ))}
            <tfoot>
              <tr className="border-t font-semibold" data-testid="week-total">
                <td colSpan={3}>Week total</td>
                <td className="text-right">{total}</td>
                <td />
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </section>
  );
}

function UnbilledTable({ rows }: { rows: UnbilledCase[] | null }) {
  return (
    <div className="space-y-2">
      <h2 className="text-lg font-semibold">Unbilled hours by case</h2>
      {rows == null ? (
        <p className="text-sm text-red-700">Couldn&apos;t load unbilled hours. Try again.</p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-gray-600">No unbilled hours.</p>
      ) : (
        <table className="w-full text-sm" data-testid="unbilled-table">
          <thead>
            <tr className="text-left"><th>Case #</th><th>Title</th><th className="text-right">Unbilled</th></tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.caseid}>
                <td><Link className="underline" href={`/cases/${r.caseid}`}>{r.caseid}</Link></td>
                <td>{r.casetitle}</td>
                <td className="text-right">{r.hours}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
