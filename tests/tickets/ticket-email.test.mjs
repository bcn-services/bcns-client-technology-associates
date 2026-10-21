// Ticket notification emails (new, closed, reopened): fake db + fake fetch only, never the network (api.resend.com is never contacted).
import { test } from "node:test";
import assert from "node:assert/strict";
import { runAddTicket, runCloseTicket, runReopenTicket, sendTicketEmail } from "../../lib/tickets.ts";
import { getConfig } from "../../lib/env.ts";
import { memDb } from "./fakedb.mjs";

const CFG = { apiKey: "re_test", apiUrl: "https://mail.test/", from: "from@example.test", to: "notify@example.test" };
const form = (o) => { const f = new FormData(); for (const [k, v] of Object.entries(o)) f.set(k, v); return f; };

const SEED = { tickets: [{ id: 7, ticketdate: "2026-10-02", description: "Print button is missing", status: "In review", createdat: "x" }] };
/** db whose inserts fail with `error` when given. */
const fakeDb = (error = null) => memDb(SEED, error ? { insertError: error } : {});
const ops = (db) => db.writes.length;

/** Wires notify -> sendTicketEmail with a recording fake fetch. */
function setup({ cfg = CFG, db = fakeDb(), fetchImpl } = {}) {
  const sent = [], redirects = [];
  const fetchFn = fetchImpl ?? (async (url, init) => { sent.push({ url, init, body: JSON.parse(init.body) }); return { ok: true, status: 200 }; });
  const deps = {
    session: async () => ({ userId: "u", email: "e", role: "staff", personId: null }),
    db: () => db, revalidatePath() {}, redirect: (u) => redirects.push(u),
    notify: (t) => sendTicketEmail(cfg, t, fetchFn),
  };
  return { sent, redirects, deps, db };
}

test("add: one email with right to/from/subject/body, after the insert", async () => {
  const s = setup();
  await runAddTicket(form({ date: "2026-10-21", description: "  Add a print button  " }), s.deps);
  assert.equal(ops(s.db), 1);
  assert.equal(s.sent.length, 1);
  const { url, init, body } = s.sent[0];
  assert.equal(url, "https://mail.test/emails");
  assert.equal(init.method, "POST");
  assert.equal(init.headers.authorization, "Bearer re_test");
  assert.deepEqual(body, { from: "from@example.test", to: ["notify@example.test"], subject: "New ticket: Add a print button", text: "Date: 2026-10-21\n\nAdd a print button" });
  assert.deepEqual(s.redirects, ["/tickets"]);
});

test("long description: subject cut to ~60 chars, body keeps the full text", async () => {
  const s = setup();
  const long = "x".repeat(200);
  await runAddTicket(form({ date: "2026-10-21", description: long }), s.deps);
  assert.equal(s.sent[0].body.subject, `New ticket: ${"x".repeat(60)}...`);
  assert.equal(s.sent[0].body.text, `Date: 2026-10-21\n\n${long}`);
});

test("subject never has CR/LF, even with newlines in the description", async () => {
  const s = setup();
  await runAddTicket(form({ date: "2026-10-21", description: "line one\r\nBcc: evil@x.test\nline three" }), s.deps);
  assert.doesNotMatch(s.sent[0].body.subject, /[\r\n]/);
  assert.equal(s.sent[0].body.subject, "New ticket: line one Bcc: evil@x.test line three");
  assert.match(s.sent[0].body.text, /line one\r\nBcc: evil@x\.test\nline three/); // body is untouched plain text
});

test("TICKET_NOTIFY_EMAIL unset/blank (via getConfig) or key/from missing: no send, no error, same redirect", async () => {
  const saved = process.env.TICKET_NOTIFY_EMAIL;
  try {
    for (const v of [undefined, "", "   "]) {
      if (v === undefined) delete process.env.TICKET_NOTIFY_EMAIL; else process.env.TICKET_NOTIFY_EMAIL = v;
      const to = getConfig().ticketNotifyEmail;
      assert.equal(to, undefined);
      const s = setup({ cfg: { ...CFG, to } });
      await runAddTicket(form({ date: "2026-10-21", description: "ok" }), s.deps);
      assert.deepEqual({ sent: s.sent.length, redirects: s.redirects }, { sent: 0, redirects: ["/tickets"] });
    }
    process.env.TICKET_NOTIFY_EMAIL = " me@x.test ";
    assert.equal(getConfig().ticketNotifyEmail, "me@x.test");
  } finally {
    if (saved === undefined) delete process.env.TICKET_NOTIFY_EMAIL; else process.env.TICKET_NOTIFY_EMAIL = saved;
  }
  const savedFrom = [process.env.TICKET_FROM_EMAIL, process.env.BILL_FROM_EMAIL];
  try {
    delete process.env.TICKET_FROM_EMAIL; delete process.env.BILL_FROM_EMAIL;
    assert.equal(getConfig().ticketFromEmail, undefined);
    process.env.BILL_FROM_EMAIL = "bill@x.test";
    assert.equal(getConfig().ticketFromEmail, "bill@x.test"); // fallback
    process.env.TICKET_FROM_EMAIL = "bot@x.test";
    assert.equal(getConfig().ticketFromEmail, "bot@x.test"); // own value wins
    delete process.env.BILL_FROM_EMAIL;
    assert.deepEqual([getConfig().ticketFromEmail, getConfig().billFromEmail], ["bot@x.test", undefined]); // bill email stays off
  } finally {
    for (const [k, v] of [["TICKET_FROM_EMAIL", savedFrom[0]], ["BILL_FROM_EMAIL", savedFrom[1]]]) if (v === undefined) delete process.env[k]; else process.env[k] = v;
  }
  for (const cfg of [{ ...CFG, apiKey: undefined }, { ...CFG, from: undefined }]) {
    const s = setup({ cfg });
    await runAddTicket(form({ date: "2026-10-21", description: "ok" }), s.deps);
    assert.deepEqual({ sent: s.sent.length, redirects: s.redirects }, { sent: 0, redirects: ["/tickets"] });
  }
});

test("no send when validation or the insert fails", async () => {
  const log = console.error; console.error = () => {};
  try {
    const bad = setup({ db: fakeDb({ message: "pg: boom" }) });
    await runAddTicket(form({ date: "2026-10-21", description: "ok" }), bad.deps);
    assert.deepEqual({ sent: bad.sent.length, redirects: bad.redirects }, { sent: 0, redirects: ["/tickets?error=failed"] });
    const invalid = setup();
    await runAddTicket(form({ date: "nope", description: "ok" }), invalid.deps);
    assert.deepEqual({ sent: invalid.sent.length, ops: ops(invalid.db), redirects: invalid.redirects }, { sent: 0, ops: 0, redirects: ["/tickets?error=date"] });
  } finally { console.error = log; }
});

test("send failure (non-2xx or thrown) is logged, never fails the action or changes the redirect", async () => {
  const logged = [];
  const log = console.error; console.error = (...a) => logged.push(a.join(" "));
  try {
    for (const fetchImpl of [async () => ({ ok: false, status: 500 }), async () => { throw new Error("socket hang up"); }]) {
      const s = setup({ fetchImpl });
      await runAddTicket(form({ date: "2026-10-21", description: "ok" }), s.deps);
      assert.deepEqual({ ops: ops(s.db), redirects: s.redirects }, { ops: 1, redirects: ["/tickets"] });
    }
  } finally { console.error = log; }
  assert.equal(logged.length, 2);
  assert.ok(logged.every((l) => !l.includes("re_test")));
});

test("reply_to is t<id>@<domain> only when a reply domain is set; id is the new row's id", async () => {
  const none = setup();
  await runAddTicket(form({ date: "2026-10-21", description: "first" }), none.deps);
  assert.ok(!("reply_to" in none.sent[0].body));
  const s = setup({ cfg: { ...CFG, replyDomain: "abc123.resend.app" } });
  await runAddTicket(form({ date: "2026-10-21", description: "second" }), s.deps);
  assert.equal(s.sent[0].body.reply_to, "t8@abc123.resend.app"); // seed holds id 7
});

test("close: one email 'Ticket closed: ...' with the response and current description; response stored", async () => {
  const s = setup({ cfg: { ...CFG, replyDomain: "abc123.resend.app" } });
  await runCloseTicket(form({ id: "7", response: "  Shipped today  " }), s.deps);
  assert.equal(s.sent.length, 1);
  assert.deepEqual(s.sent[0].body, {
    from: "from@example.test", to: ["notify@example.test"], reply_to: "t7@abc123.resend.app",
    subject: "Ticket closed: Print button is missing",
    text: "Ticket #7 was closed.\n\nResponse:\nShipped today\n\nTicket (2026-10-02):\nPrint button is missing",
  });
  assert.deepEqual(s.redirects, ["/tickets"]);
  assert.equal(s.db.tables.ticket_messages[0].body, "Shipped today");
});

test("reopen without a response: email says reopened, has no Response section", async () => {
  const s = setup();
  await runReopenTicket(form({ id: "7" }), s.deps);
  assert.equal(s.sent.length, 1);
  assert.equal(s.sent[0].body.subject, "Ticket reopened: Print button is missing");
  assert.equal(s.sent[0].body.text, "Ticket #7 was reopened.\n\nTicket (2026-10-02):\nPrint button is missing");
  assert.ok(!("reply_to" in s.sent[0].body));
});

test("close/reopen: no email when the change is refused (unknown id, wrong state, too-long response); a send failure never changes the redirect", async () => {
  const s = setup();
  await runCloseTicket(form({ id: "99" }), s.deps);
  await runReopenTicket(form({ id: "abc" }), s.deps);
  await runCloseTicket(form({ id: "7", response: "x".repeat(2001) }), s.deps);
  assert.equal(s.sent.length, 0);
  assert.deepEqual(s.redirects, ["/tickets?error=notfound", "/tickets?error=notfound", "/tickets?error=response"]);
  await runCloseTicket(form({ id: "7" }), s.deps);
  await runCloseTicket(form({ id: "7" }), s.deps); // already Closed
  assert.deepEqual({ sent: s.sent.length, last: s.redirects.at(-1) }, { sent: 1, last: "/tickets?error=state" });

  const log = console.error; console.error = () => {};
  try {
    const f = setup({ fetchImpl: async () => ({ ok: false, status: 500 }) });
    await runReopenTicket(form({ id: "7" }), f.deps);
    assert.deepEqual({ redirects: f.redirects, status: f.db.tables.tickets[0].status }, { redirects: ["/tickets"], status: "Open" });
  } finally { console.error = log; }
});

test("getConfig reads TICKET_REPLY_DOMAIN and TICKET_INBOUND_SECRET lazily, trimmed, blank = unset", () => {
  const keys = ["TICKET_REPLY_DOMAIN", "TICKET_INBOUND_SECRET"];
  const saved = keys.map((k) => process.env[k]);
  try {
    for (const k of keys) delete process.env[k];
    assert.deepEqual([getConfig().ticketReplyDomain, getConfig().ticketInboundSecret], [undefined, undefined]);
    process.env.TICKET_REPLY_DOMAIN = "  ";
    assert.equal(getConfig().ticketReplyDomain, undefined);
    process.env.TICKET_REPLY_DOMAIN = " abc.resend.app ";
    process.env.TICKET_INBOUND_SECRET = " whsec_x ";
    assert.deepEqual([getConfig().ticketReplyDomain, getConfig().ticketInboundSecret], ["abc.resend.app", "whsec_x"]);
  } finally {
    keys.forEach((k, i) => { if (saved[i] === undefined) delete process.env[k]; else process.env[k] = saved[i]; });
  }
});
