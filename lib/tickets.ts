// Tickets: change requests logged by staff. Edits are status, response messages, and the description until Closed; only an admin deletes, and only a Closed ticket.
import type { Db } from "@/lib/time/entries";
import type { Session } from "@/lib/auth/session";

export type TicketStatus = "Open" | "In review" | "Closed";
/** `author` is the staff member's email, or 'email' for Nate's inbound reply. */
export type TicketMessage = { id: number; ticketid: number; author: string; body: string; createdat: string };
export type Ticket = { id: number; ticketdate: string; description: string; status: TicketStatus; createdat: string; messages: TicketMessage[] };
export type Dir = "asc" | "desc";
export type Sort = { by: "status" | "date"; dir: Dir };

export class TicketError extends Error {
  constructor(public code: "date" | "description" | "response" | "notfound" | "state" | "forbidden") {
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
  forbidden: "Only an admin can delete a ticket.",
};
export const ticketErrorMessage = (code: string) => MESSAGES[code] ?? "Save failed; nothing was changed.";

/** `?sort=status|date&dir=asc|desc` whitelist; anything else is the default (same order as status asc). */
export function parseSort(sort: string, dir: string): Sort | null {
  return (sort === "status" || sort === "date") && (dir === "asc" || dir === "desc") ? { by: sort, dir } : null;
}

const PAGE = 1000;
const RANK: Record<TicketStatus, number> = { "In review": 0, Open: 1, Closed: 2 };

/**
 * Default / sort=status: In review first, then Open, then Closed (dir=desc reverses that), then newest ticketdate, then newest id.
 * sort=date: ticketdate (asc oldest first, desc newest first), ties by id the same way; status is ignored.
 * Each ticket carries its messages, oldest first.
 */
// ponytail: sorted in JS over the whole table — move to SQL paging when tickets reach the thousands.
export async function listTickets(db: Db, sort: Sort | null): Promise<Ticket[]> {
  // The two reads don't depend on each other (messages are not filtered by ticket id), so they run side by side.
  const [{ data, error }, byTicket] = await Promise.all([db.from("tickets").select("id, ticketdate, description, status, createdat"), loadMessages(db)]);
  if (error) throw error;
  const rows = (data ?? []) as Omit<Ticket, "messages">[];
  const flip = sort?.dir === "desc" ? -1 : 1;
  const withMessages = rows.map((r) => ({ ...r, messages: (byTicket.get(r.id) ?? []).sort((a, b) => a.createdat.localeCompare(b.createdat) || a.id - b.id) }));
  if (sort?.by === "date") return withMessages.sort((a, b) => flip * (a.ticketdate.localeCompare(b.ticketdate) || a.id - b.id));
  return withMessages.sort((a, b) => flip * (RANK[a.status] - RANK[b.status]) || b.ticketdate.localeCompare(a.ticketdate) || b.id - a.id);
}

/** Every message grouped by ticket. Closed rows show their history too, so all are loaded; paged by id because PostgREST caps a response at 1000 rows
 * (and an .in("ticketid", ids) of every ticket would outgrow the URL first). */
// ponytail: all messages on every render — upgrade to the visible tickets' messages when the thread count reaches the thousands.
async function loadMessages(db: Db): Promise<Map<number, TicketMessage[]>> {
  const byTicket = new Map<number, TicketMessage[]>();
  for (let from = 0; ; from += PAGE) {
    const res = await db.from("ticket_messages").select("id, ticketid, author, body, createdat").order("id").range(from, from + PAGE - 1);
    if (res.error) throw res.error;
    const page = (res.data ?? []) as TicketMessage[];
    for (const m of page) byTicket.set(m.ticketid, [...(byTicket.get(m.ticketid) ?? []), m]);
    if (page.length < PAGE) break;
  }
  return byTicket;
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

/**
 * One conditional write: the ticket moves to `to` only while its status is in `from`, and the row's fields for the notification come back
 * with it. 0 rows is a lost race ("state") or an unknown id ("notfound"); only that path pays a second read to tell them apart.
 */
export async function moveTicket(db: Db, id: number, to: TicketStatus, from: TicketStatus[]): Promise<{ ticketdate: string; description: string }> {
  const { data, error } = await db.from("tickets").update({ status: to }).eq("id", id).in("status", from).select("ticketdate, description");
  if (error) throw error;
  if (data?.length) return data[0] as { ticketdate: string; description: string };
  const cur = await db.from("tickets").select("id").eq("id", id);
  if (cur.error) throw cur.error;
  throw new TicketError(cur.data?.length ? "state" : "notfound");
}

/** Description edit, allowed until the ticket is Closed. */
export async function editTicket(db: Db, id: number, description: string): Promise<void> {
  const text = checkDescription(description);
  if ((await loadTicket(db, id)).status === "Closed") throw new TicketError("state");
  const { data, error } = await db.from("tickets").update({ description: text }).eq("id", id).in("status", ["Open", "In review"]).select("id");
  if (error) throw error;
  if (!data?.length) throw new TicketError("state");
}

/**
 * Admin-only hard delete of a CLOSED ticket (HQ's `tickets` job marks the ticket's HQ task done when it sees the source Closed, so deleting
 * only closed tickets keeps the task from being orphaned). `ticket_messages.ticketid` is on delete restrict (0014), so the messages go first.
 * ponytail: two writes, no transaction: a reopen between them loses that ticket's messages, and a close-then-delete inside HQ's 15-minute pull
 * leaves its task open. Add a security-definer delete function (one migration) if either ever happens.
 */
export async function deleteTicket(db: Db, id: number): Promise<void> {
  if ((await loadTicket(db, id)).status !== "Closed") throw new TicketError("state"); // notfound if the id is gone
  const msgs = await db.from("ticket_messages").delete().eq("ticketid", id);
  if (msgs.error) throw msgs.error;
  const { data, error } = await db.from("tickets").delete().eq("id", id).eq("status", "Closed").select("id");
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
 * signed-in user and included in the email. Without a response the whole move is one conditional update. With one, the ticket is read
 * first (a stale tab's click is refused before anything is written, so no message and no audit rows), the message is written, and it is
 * deleted again if the update still loses a race, so a move that didn't happen leaves no response behind and none is ever lost.
 */
const move = (to: TicketStatus, from: TicketStatus[], kind: "closed" | "reopened", where: string) => (formData: FormData, deps: TicketDeps) =>
  run(async (db, f, session) => {
    const id = idOf(f);
    const response = str(f, "response").trim();
    if (response.length > 2000) throw new TicketError("response");
    let messageId: number | null = null;
    if (response) {
      if (!from.includes((await loadTicket(db, id)).status)) throw new TicketError("state"); // notfound if the id is gone
      try {
        messageId = await addMessage(db, id, session.email || "staff", response);
      } catch (e) {
        if ((e as { code?: string })?.code === "23503") throw new TicketError("notfound"); // ticket_messages_ticketid_fkey: gone since the read
        throw e;
      }
    }
    let t: { ticketdate: string; description: string };
    try {
      t = await moveTicket(db, id, to, from);
    } catch (e) {
      // Lost the race (or the write failed) after the read: take the response back. supabase-js resolves with {error} rather than rejecting.
      if (messageId !== null) {
        const cleanup = await db.from("ticket_messages").delete().eq("id", messageId).then((r: { error?: { message?: string } | null }) => r.error?.message ?? null, (err: unknown) => (err instanceof Error ? err.message : "failed"));
        if (cleanup) console.error(`move ticket ${id} response ${messageId} cleanup failed: ${cleanup}`);
      }
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

export const runDeleteTicket = (formData: FormData, deps: TicketDeps) =>
  run(async (db, f, session) => {
    if (session.role !== "admin") throw new TicketError("forbidden");
    await deleteTicket(db, idOf(f));
  }, "deleteTicket", formData, deps);
