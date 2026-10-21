import { requireSession } from "@/lib/auth/session";
import { createServerClient } from "@/lib/db/client";
import { firmToday } from "@/lib/cases/presets";
import type { Db } from "@/lib/time/entries";
import { listTickets, parseSort, ticketErrorMessage } from "@/lib/tickets";
import { addTicket, closeTicket, reopenTicket } from "./actions";

export const dynamic = "force-dynamic";

type Params = Record<string, string | string[] | undefined>;
const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

/** Change-request log for all signed-in users. Status header sorts via `?sort=status&dir=asc|desc`; default is Open first. */
export default async function TicketsPage({ searchParams }: { searchParams: Params }) {
  const dir = parseSort(first(searchParams.sort), first(searchParams.dir));
  const [, tickets] = await Promise.all([requireSession(), listTickets(createServerClient() as unknown as Db, dir)]);
  const error = first(searchParams.error);
  const desc = dir === "desc";
  return (
    <main className="mx-auto max-w-4xl space-y-4 px-4 py-6">
      <h1 className="text-xl font-semibold">Tickets</h1>
      {error && <p role="alert" className="text-sm text-red-700">{ticketErrorMessage(error)}</p>}
      {/* Keyed per render: a same-URL redirect must remount the form so the inputs clear. */}
      <form key={Date.now()} action={addTicket} className="flex flex-wrap items-end gap-2 text-sm">
        <label className="sr-only" htmlFor="date">Date</label>
        <input id="date" name="date" type="date" required defaultValue={firmToday(new Date())} className="rounded border px-2 py-1" />
        <label className="sr-only" htmlFor="description">Description</label>
        <input id="description" name="description" required maxLength={2000} placeholder="Description" className="min-w-0 flex-1 rounded border px-2 py-1" />
        <button className="rounded bg-slate-800 px-3 py-1 text-white">Add</button>
      </form>
      <div className="overflow-x-auto">
        <table className="w-full text-sm [&_td]:py-1 [&_td]:pr-3 [&_th]:py-1 [&_th]:pr-3 [&_tr]:border-b">
          <thead>
            <tr className="text-left text-slate-700">
              <th>Date</th>
              <th>Description</th>
              <th aria-sort={desc ? "descending" : "ascending"}>
                <a href={`/tickets?sort=status&dir=${desc ? "asc" : "desc"}`} className="underline">Status {desc ? "↓" : "↑"}</a>
              </th>
              <th />
            </tr>
          </thead>
          <tbody>
            {tickets.map((t) => {
              const open = t.status === "Open";
              return (
                <tr key={t.id}>
                  <td className="whitespace-nowrap">{t.ticketdate}</td>
                  <td className="whitespace-pre-wrap break-words">{t.description}</td>
                  <td>
                    <span className={`rounded px-2 py-0.5 text-xs ${open ? "bg-amber-100 text-amber-800" : "bg-green-100 text-green-800"}`}>{t.status}</span>
                  </td>
                  <td className="text-right">
                    <form action={open ? closeTicket : reopenTicket}>
                      <input type="hidden" name="id" value={t.id} />
                      <button className="rounded border border-slate-300 px-3 py-1">{open ? "Close" : "Reopen"}</button>
                    </form>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </main>
  );
}
