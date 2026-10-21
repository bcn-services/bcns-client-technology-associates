// New-ticket notification email: fake db + fake fetch only, never the network (api.resend.com is never contacted).
import { test } from "node:test";
import assert from "node:assert/strict";
import { runAddTicket, runCloseTicket, runReopenTicket, sendTicketEmail } from "../../lib/tickets.ts";
import { getConfig } from "../../lib/env.ts";

const CFG = { apiKey: "re_test", apiUrl: "https://mail.test/", from: "from@example.test", to: "notify@example.test" };
const form = (o) => { const f = new FormData(); for (const [k, v] of Object.entries(o)) f.set(k, v); return f; };

/** db whose insert resolves to `error` (or ok); `ops` counts inserts. */
const fakeDb = (error = null) => {
  const db = {
    ops: 0,
    from() {
      const b = {
        insert: () => { db.ops++; return Promise.resolve({ error }); },
        update: () => b, eq: () => b, select: () => Promise.resolve({ data: [{ id: 1 }], error }),
      };
      return b;
    },
  };
  return db;
};

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
  assert.equal(s.db.ops, 1);
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
    assert.deepEqual({ sent: invalid.sent.length, ops: invalid.db.ops, redirects: invalid.redirects }, { sent: 0, ops: 0, redirects: ["/tickets?error=date"] });
  } finally { console.error = log; }
});

test("send failure (non-2xx or thrown) is logged, never fails the action or changes the redirect", async () => {
  const logged = [];
  const log = console.error; console.error = (...a) => logged.push(a.join(" "));
  try {
    for (const fetchImpl of [async () => ({ ok: false, status: 500 }), async () => { throw new Error("socket hang up"); }]) {
      const s = setup({ fetchImpl });
      await runAddTicket(form({ date: "2026-10-21", description: "ok" }), s.deps);
      assert.deepEqual({ ops: s.db.ops, redirects: s.redirects }, { ops: 1, redirects: ["/tickets"] });
    }
  } finally { console.error = log; }
  assert.equal(logged.length, 2);
  assert.ok(logged.every((l) => !l.includes("re_test")));
});

test("close and reopen never send", async () => {
  const s = setup();
  await runCloseTicket(form({ id: "1" }), s.deps);
  await runReopenTicket(form({ id: "1" }), s.deps);
  assert.deepEqual({ sent: s.sent.length, redirects: s.redirects }, { sent: 0, redirects: ["/tickets", "/tickets"] });
});
