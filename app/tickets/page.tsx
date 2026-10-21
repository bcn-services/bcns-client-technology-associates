import { requireSession } from "@/lib/auth/session";
import { createServerClient } from "@/lib/db/client";
import { firmToday } from "@/lib/cases/presets";
import type { Db } from "@/lib/time/entries";
import { listTickets, parseSort, ticketErrorMessage } from "@/lib/tickets";
import { addTicket, closeTicket, editTicket, reopenTicket } from "./actions";
import { RowActions, StatusBadge, TicketStatusProvider } from "./optimistic-status";
import { SubmitButton } from "./submit-button";

export const dynamic = "force-dynamic";

type Params = Record<string, string | string[] | undefined>;
const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

/** Change-request log for all signed-in users. Status header sorts via `?sort=status&dir=asc|desc`; default is In review, Open, then Closed. */
export default async function TicketsPage({ searchParams }: { searchParams: Params }) {
  const dir = parseSort(first(searchParams.sort), first(searchParams.dir));
  const [, tickets] = await Promise.all([requireSession(), listTickets(createServerClient() as unknown as Db, dir)]);
  const error = first(searchParams.error);
  const desc = dir === "desc";
  const stamp = Date.now(); // keys the per-row forms like the add form: a same-URL redirect remounts them so the inputs clear
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
        <SubmitButton label="Add" className="rounded bg-slate-800 px-3 py-1 text-white" />
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
            {tickets.map((t) => (
              <TicketStatusProvider key={t.id} status={t.status}>
                <tr className="align-top">
                  <td className="whitespace-nowrap">{t.ticketdate}</td>
                  <td className="space-y-1 whitespace-pre-wrap break-words">
                    <div>{t.description}</div>
                    {t.messages.map((m) => (
                      <blockquote key={m.id} className="border-l-2 border-slate-300 pl-2 text-slate-700">
                        <span className="block text-xs text-slate-500">{m.author === "email" ? "Reply by email" : m.author} · {m.createdat.slice(0, 10)}</span>
                        {m.body}
                      </blockquote>
                    ))}
                    {t.status !== "Closed" && (
                      <details className="whitespace-normal">
                        <summary className="cursor-pointer text-xs text-slate-600">Edit</summary>
                        <form key={`edit-${t.id}-${stamp}`} action={editTicket} className="mt-1 flex gap-2">
                          <input type="hidden" name="id" value={t.id} />
                          <label className="sr-only" htmlFor={`desc-${t.id}`}>Description</label>
                          <textarea id={`desc-${t.id}`} name="description" required maxLength={2000} rows={2} defaultValue={t.description} className="min-w-0 flex-1 rounded border px-2 py-1" />
                          <SubmitButton label="Save" className="self-start rounded border border-slate-300 px-3 py-1" />
                        </form>
                      </details>
                    )}
                  </td>
                  <td>
                    <StatusBadge />
                  </td>
                  <td className="text-right">
                    <RowActions key={`act-${t.id}-${stamp}`} id={t.id} close={closeTicket} reopen={reopenTicket} />
                  </td>
                </tr>
              </TicketStatusProvider>
            ))}
          </tbody>
        </table>
      </div>
    </main>
  );
}
