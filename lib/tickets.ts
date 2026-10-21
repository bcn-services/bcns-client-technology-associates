// Tickets: change requests logged by staff. Nothing here deletes; status is the only edit.
import type { Db } from "@/lib/time/entries";
import type { Session } from "@/lib/auth/session";

export type TicketStatus = "Open" | "Closed";
export type Ticket = { id: number; ticketdate: string; description: string; status: TicketStatus; createdat: string };
export type Dir = "asc" | "desc";

export class TicketError extends Error {
  constructor(public code: "date" | "description" | "notfound") {
    super(code);
    this.name = "TicketError";
  }
}

const MESSAGES: Record<string, string> = {
  date: "Enter a valid date.",
  description: "Description is required (up to 2000 characters).",
  notfound: "That ticket no longer exists.",
};
export const ticketErrorMessage = (code: string) => MESSAGES[code] ?? "Save failed; nothing was changed.";

/** `?sort=status&dir=asc|desc` whitelist; anything else is the default (same order as status asc). */
export function parseSort(sort: string, dir: string): Dir | null {
  return sort === "status" && (dir === "asc" || dir === "desc") ? dir : null;
}

/** Open first (dir=desc flips to Closed first), then newest ticketdate, then newest id. */
// ponytail: sorted in JS over the whole table — move to SQL paging when tickets reach the thousands.
export async function listTickets(db: Db, dir: Dir | null): Promise<Ticket[]> {
  const { data, error } = await db.from("tickets").select("id, ticketdate, description, status, createdat");
  if (error) throw error;
  const flip = dir === "desc" ? -1 : 1;
  return [...((data ?? []) as Ticket[])].sort(
    (a, b) =>
      flip * ((a.status === "Open" ? 0 : 1) - (b.status === "Open" ? 0 : 1)) ||
      b.ticketdate.localeCompare(a.ticketdate) ||
      b.id - a.id,
  );
}

const validDate = (s: string) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return false;
  const [y, mo, day] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const d = new Date(Date.UTC(y, mo - 1, day));
  return d.getUTCFullYear() === y && d.getUTCMonth() === mo - 1 && d.getUTCDate() === day;
};

export type NewTicket = { date: string; description: string };

export async function addTicket(db: Db, date: string, description: string): Promise<NewTicket> {
  if (!validDate(date)) throw new TicketError("date");
  const text = description.trim();
  if (!text || text.length > 2000) throw new TicketError("description");
  const { error } = await db.from("tickets").insert({ ticketdate: date, description: text });
  if (error) throw error;
  return { date, description: text };
}

export type TicketMailConfig = { apiKey?: string; apiUrl: string; from?: string; to?: string };

/**
 * One plain-text notification through the Resend REST API (same call shape as lib/bill-docs/send.ts). No recipient,
 * key, or From -> nothing sent, no error. Throws on a non-2xx or network failure; the caller treats that as best-effort.
 */
export async function sendTicketEmail(cfg: TicketMailConfig, t: NewTicket, fetchFn: typeof fetch = fetch): Promise<void> {
  if (!cfg.to) return;
  if (!cfg.apiKey || !cfg.from) return console.error("ticket email: TICKET_NOTIFY_EMAIL set but RESEND_API_KEY or TICKET_FROM_EMAIL/BILL_FROM_EMAIL missing");
  const flat = t.description.replace(/\s+/g, " ").trim(); // also strips CR/LF: user text only reaches the subject line
  const subject = `New ticket: ${flat.length > 60 ? `${flat.slice(0, 60).trimEnd()}...` : flat}`;
  const res = await fetchFn(`${cfg.apiUrl.replace(/\/+$/, "")}/emails`, {
    method: "POST",
    headers: { authorization: `Bearer ${cfg.apiKey}`, "content-type": "application/json" },
    body: JSON.stringify({ from: cfg.from, to: [cfg.to], subject, text: `Date: ${t.date}\n\n${t.description}` }),
    signal: AbortSignal.timeout(5_000), // awaited before the redirect: keep short so a hung Resend doesn't invite a double Add
  });
  if (!res.ok) throw new Error(`email service answered ${res.status}: ${(await res.text().catch(() => "")).slice(0, 200)}`);
}

export async function setStatus(db: Db, id: number, status: TicketStatus): Promise<void> {
  const { data, error } = await db.from("tickets").update({ status }).eq("id", id).select("id");
  if (error) throw error;
  if (!data?.length) throw new TicketError("notfound");
}

export type TicketDeps = {
  session: () => Promise<Session>;
  db: () => Db;
  revalidatePath: (p: string) => void;
  redirect: (url: string) => void;
  /** Called once after a successful add; failures are logged and ignored. Omitted -> no notification. */
  notify?: (t: NewTicket) => Promise<void>;
};

/** Shared action body: signed-in check first (before any DB call), then the op; failures go back as ?error=. */
async function run(op: (db: Db, formData: FormData) => Promise<void>, where: string, formData: FormData, deps: TicketDeps): Promise<void> {
  let code: string | null = null;
  try {
    await deps.session(); // any signed-in role; requireSession redirects to /login otherwise
    await op(deps.db(), formData);
  } catch (e) {
    if (e instanceof TicketError) code = e.code;
    else if ((e as { digest?: unknown })?.digest?.toString().startsWith("NEXT_REDIRECT")) throw e; // the /login redirect
    else {
      console.error(`${where}:`, e); // raw DB text stays in the server log
      code = "failed";
    }
  }
  deps.revalidatePath("/tickets");
  deps.redirect(code ? `/tickets?error=${code}` : "/tickets");
}

const str = (formData: FormData, k: string) => (typeof formData.get(k) === "string" ? String(formData.get(k)) : "");
const idOf = (formData: FormData): number => {
  const raw = str(formData, "id");
  if (!/^\d{1,9}$/.test(raw) || Number(raw) <= 0) throw new TicketError("notfound");
  return Number(raw);
};

export const runAddTicket = (formData: FormData, deps: TicketDeps) =>
  run(async (db, f) => {
    const added = await addTicket(db, str(f, "date"), str(f, "description"));
    try {
      await deps.notify?.(added); // best-effort, only after the insert succeeded
    } catch (e) {
      console.error("addTicket notify:", e instanceof Error ? e.message : "failed");
    }
  }, "addTicket", formData, deps);
export const runCloseTicket = (formData: FormData, deps: TicketDeps) => run((db, f) => setStatus(db, idOf(f), "Closed"), "closeTicket", formData, deps);
export const runReopenTicket = (formData: FormData, deps: TicketDeps) => run((db, f) => setStatus(db, idOf(f), "Open"), "reopenTicket", formData, deps);
