// Tickets: change requests logged by staff. Nothing here deletes; edits are status, response messages, and the description until Closed.
import type { Db } from "@/lib/time/entries";
import type { Session } from "@/lib/auth/session";

export type TicketStatus = "Open" | "In review" | "Closed";
/** `author` is the staff member's email, or 'email' for Nate's inbound reply. */
export type TicketMessage = { id: number; ticketid: number; author: string; body: string; createdat: string };
export type Ticket = { id: number; ticketdate: string; description: string; status: TicketStatus; createdat: string; messages: TicketMessage[] };
export type Dir = "asc" | "desc";

export class TicketError extends Error {
  constructor(public code: "date" | "description" | "response" | "notfound" | "state") {
    super(code);
    this.name = "TicketError";
  }
}

const MESSAGES: Record<string, string> = {
  date: "Enter a valid date.",
  description: "Description is required (up to 2000 characters).",
  response: "Response is too long (up to 2000 characters).",
  notfound: "That ticket no longer exists.",
  state: "That ticket was already changed; check its status and try again.",
};
export const ticketErrorMessage = (code: string) => MESSAGES[code] ?? "Save failed; nothing was changed.";

/** `?sort=status&dir=asc|desc` whitelist; anything else is the default (same order as status asc). */
export function parseSort(sort: string, dir: string): Dir | null {
  return sort === "status" && (dir === "asc" || dir === "desc") ? dir : null;
}

const PAGE = 1000;
const RANK: Record<TicketStatus, number> = { "In review": 0, Open: 1, Closed: 2 };

/** In review first, then Open, then Closed (dir=desc reverses that), then newest ticketdate, then newest id. Each ticket carries its messages, oldest first. */
// ponytail: sorted in JS over the whole table — move to SQL paging when tickets reach the thousands.
export async function listTickets(db: Db, dir: Dir | null): Promise<Ticket[]> {
  const { data, error } = await db.from("tickets").select("id, ticketdate, description, status, createdat");
  if (error) throw error;
  const rows = (data ?? []) as Omit<Ticket, "messages">[];
  const byTicket = new Map<number, TicketMessage[]>();
  // Closed rows show their history too, so every message is loaded; paged by id because PostgREST caps a response at 1000 rows
  // (and an .in("ticketid", ids) of every ticket would outgrow the URL first).
  // ponytail: all messages on every render — upgrade to the visible tickets' messages when the thread count reaches the thousands.
  for (let from = 0; ; from += PAGE) {
    const res = await db.from("ticket_messages").select("id, ticketid, author, body, createdat").order("id").range(from, from + PAGE - 1);
    if (res.error) throw res.error;
    const page = (res.data ?? []) as TicketMessage[];
    for (const m of page) byTicket.set(m.ticketid, [...(byTicket.get(m.ticketid) ?? []), m]);
    if (page.length < PAGE) break;
  }
  const flip = dir === "desc" ? -1 : 1;
  return rows
    .map((r) => ({ ...r, messages: (byTicket.get(r.id) ?? []).sort((a, b) => a.createdat.localeCompare(b.createdat) || a.id - b.id) }))
    .sort((a, b) => flip * (RANK[a.status] - RANK[b.status]) || b.ticketdate.localeCompare(a.ticketdate) || b.id - a.id);
}

const validDate = (s: string) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return false;
  const [y, mo, day] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const d = new Date(Date.UTC(y, mo - 1, day));
  return d.getUTCFullYear() === y && d.getUTCMonth() === mo - 1 && d.getUTCDate() === day;
};

const checkDescription = (description: string): string => {
  const text = description.trim();
  if (!text || text.length > 2000) throw new TicketError("description");
  return text;
};

export async function addTicket(db: Db, date: string, description: string): Promise<{ id: number; date: string; description: string }> {
  if (!validDate(date)) throw new TicketError("date");
  const text = checkDescription(description);
  const { data, error } = await db.from("tickets").insert({ ticketdate: date, description: text }).select("id");
  if (error) throw error;
  return { id: data[0].id as number, date, description: text };
}

type Row = { id: number; ticketdate: string; description: string; status: TicketStatus };
async function loadTicket(db: Db, id: number): Promise<Row> {
  const { data, error } = await db.from("tickets").select("id, ticketdate, description, status").eq("id", id);
  if (error) throw error;
  if (!data?.length) throw new TicketError("notfound");
  return data[0] as Row;
}

/** `from` limits which current statuses may move; a ticket that changed under us is a "state" error. */
export async function setStatus(db: Db, id: number, status: TicketStatus, from?: TicketStatus[]): Promise<void> {
  let q = db.from("tickets").update({ status }).eq("id", id);
  if (from) q = q.in("status", from);
  const { data, error } = await q.select("id");
  if (error) throw error;
  if (!data?.length) throw new TicketError(from ? "state" : "notfound");
}

/** Description edit, allowed until the ticket is Closed. */
export async function editTicket(db: Db, id: number, description: string): Promise<void> {
  const text = checkDescription(description);
  if ((await loadTicket(db, id)).status === "Closed") throw new TicketError("state");
  const { data, error } = await db.from("tickets").update({ description: text }).eq("id", id).in("status", ["Open", "In review"]).select("id");
  if (error) throw error;
  if (!data?.length) throw new TicketError("state");
}

/** Returns the new message's id. An author of 'email' also moves the ticket to In review (trigger ticket_reply_review, 0014). */
export async function addMessage(db: Db, ticketid: number, author: string, body: string, resendEmailId?: string): Promise<number> {
  const { data, error } = await db.from("ticket_messages").insert({ ticketid, author, body, ...(resendEmailId ? { resend_email_id: resendEmailId } : {}) }).select("id");
  if (error) throw error;
  return data[0].id as number;
}

export type TicketMail = { id: number; kind: "new" | "closed" | "reopened"; date: string; description: string; response?: string };
export type TicketMailConfig = { apiKey?: string; apiUrl: string; from?: string; to?: string; replyDomain?: string };

const SUBJECT_PREFIX = { new: "New ticket", closed: "Ticket closed", reopened: "Ticket reopened" } as const;

/**
 * One plain-text notification through the Resend REST API (same call shape as lib/bill-docs/send.ts). No recipient,
 * key, or From -> nothing sent, no error. Throws on a non-2xx or network failure; the caller treats that as best-effort.
 * With a reply domain set, reply_to is `t<id>@<domain>` so a plain Reply lands on the ticket (app/api/tickets/inbound).
 */
export async function sendTicketEmail(cfg: TicketMailConfig, t: TicketMail, fetchFn: typeof fetch = fetch): Promise<void> {
  if (!cfg.to) return;
  if (!cfg.apiKey || !cfg.from) return console.error("ticket email: TICKET_NOTIFY_EMAIL set but RESEND_API_KEY or TICKET_FROM_EMAIL/BILL_FROM_EMAIL missing");
  const flat = t.description.replace(/\s+/g, " ").trim(); // also strips CR/LF: user text only reaches the subject line
  const subject = `${SUBJECT_PREFIX[t.kind]}: ${flat.length > 60 ? `${flat.slice(0, 60).trimEnd()}...` : flat}`;
  const text =
    t.kind === "new"
      ? `Date: ${t.date}\n\n${t.description}`
      : `Ticket #${t.id} was ${t.kind}.\n\n${t.response ? `Response:\n${t.response}\n\n` : ""}Ticket (${t.date}):\n${t.description}`;
  const res = await fetchFn(`${cfg.apiUrl.replace(/\/+$/, "")}/emails`, {
    method: "POST",
    headers: { authorization: `Bearer ${cfg.apiKey}`, "content-type": "application/json" },
    body: JSON.stringify({ from: cfg.from, to: [cfg.to], subject, text, ...(cfg.replyDomain ? { reply_to: `t${t.id}@${cfg.replyDomain}` } : {}) }),
    signal: AbortSignal.timeout(5_000), // Add awaits this before its redirect: keep short so a hung Resend doesn't stall the page
  });
  if (!res.ok) throw new Error(`email service answered ${res.status}: ${(await res.text().catch(() => "")).slice(0, 200)}`);
}

export type TicketDeps = {
  session: () => Promise<Session>;
  db: () => Db;
  revalidatePath: (p: string) => void;
  redirect: (url: string) => void;
  /** Called once after a successful add, close, or reopen; failures are logged and ignored. Omitted -> no notification. */
  notify?: (t: TicketMail) => Promise<void>;
};

/** Shared action body: signed-in check first (before any DB call), then the op; failures go back as ?error=. */
async function run(op: (db: Db, formData: FormData, session: Session) => Promise<void>, where: string, formData: FormData, deps: TicketDeps): Promise<void> {
  let code: string | null = null;
  try {
    const session = await deps.session(); // any signed-in role; requireSession redirects to /login otherwise
    await op(deps.db(), formData, session);
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

/** Best-effort, only called after the write succeeded. Never rejects: a failure is logged with the ticket id and dropped. */
async function notifyBestEffort(deps: TicketDeps, where: string, mail: TicketMail): Promise<void> {
  try {
    await deps.notify?.(mail);
  } catch (e) {
    console.error(`${where} notify ticket ${mail.id}:`, e instanceof Error ? e.message : "failed");
  }
}

export const runAddTicket = (formData: FormData, deps: TicketDeps) =>
  run(async (db, f) => {
    const added = await addTicket(db, str(f, "date"), str(f, "description"));
    await notifyBestEffort(deps, "addTicket", { ...added, kind: "new" });
  }, "addTicket", formData, deps);

/**
 * Close (from Open or In review) / reopen (from In review or Closed), with an optional response stored as a message by the
 * signed-in user and included in the email. The message is written first and deleted again if the status change doesn't
 * land (race lost or write failed), so a move that didn't happen leaves no response behind and none is ever lost.
 */
const move = (to: TicketStatus, from: TicketStatus[], kind: "closed" | "reopened", where: string) => (formData: FormData, deps: TicketDeps) =>
  run(async (db, f, session) => {
    const id = idOf(f);
    const response = str(f, "response").trim();
    if (response.length > 2000) throw new TicketError("response");
    const t = await loadTicket(db, id);
    if (!from.includes(t.status)) throw new TicketError("state");
    const messageId = response ? await addMessage(db, id, session.email || "staff", response) : null;
    try {
      await setStatus(db, id, to, from);
    } catch (e) {
      // Lost the race (or the write failed): the response was never applied to a move that didn't happen, so take it back.
      if (messageId !== null) await db.from("ticket_messages").delete().eq("id", messageId).then(() => undefined, () => undefined);
      throw e;
    }
    // Not awaited: waiting on Resend held the redirect ~1s per click. `next start` on the droplet is long-lived, so the send
    // finishes after the response. ponytail: a restart mid-send drops that email; fine for a notification, add a queue if one must land.
    void notifyBestEffort(deps, where, { id, kind, date: t.ticketdate, description: t.description, response: response || undefined });
  }, where, formData, deps);

export const runCloseTicket = move("Closed", ["Open", "In review"], "closed", "closeTicket");
export const runReopenTicket = move("Open", ["In review", "Closed"], "reopened", "reopenTicket");
export const runEditTicket = (formData: FormData, deps: TicketDeps) =>
  run((db, f) => editTicket(db, idOf(f), str(f, "description")), "editTicket", formData, deps);
