// Inbound ticket replies (Resend email.received webhook): real Svix signatures over a fake db + fake fetch; the network is never used.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { handleInbound, verifySvix, stripQuoted, bareAddress, ticketIdFrom } from "../../lib/tickets-inbound.ts";
import { memDb } from "./fakedb.mjs";

const KEY = Buffer.from("test-signing-key-0123456789abcdef");
const SECRET = `whsec_${KEY.toString("base64")}`;
const NOW_S = 1_800_000_000;
const NOTIFY = "nseluga@bcn-services.com";
const DOMAIN = "abc123.resend.app";

const sig = (id, ts, body, key = KEY) => `v1,${createHmac("sha256", key).update(`${id}.${ts}.${body}`).digest("base64")}`;
/** A correctly signed delivery at NOW_S; `over` replaces header fields to break it. */
const signed = (body, over = {}) => ({ id: "msg_1", timestamp: String(NOW_S), signature: sig("msg_1", NOW_S, body), ...over });

const EVENT = (data = {}, type = "email.received") => JSON.stringify({ type, created_at: "x", data: { email_id: "em_1", from: NOTIFY, to: [`t7@${DOMAIN}`], cc: [], bcc: [], received_for: [], message_id: "<m>", subject: "Re: x", attachments: [], ...data } });
const FULL = (over = {}) => ({
  from: NOTIFY, to: [`t7@${DOMAIN}`], received_for: [], subject: "Re: Ticket", html: null,
  text: "Looks fixed, thanks.\n\nOn Tue, Oct 21, 2026 at 3:00 PM Bot <bot@x.test> wrote:\n> Ticket #7 was closed.\n> Response: done",
  authentication: { spf: "pass", dkim: "pass", dmarc: "pass" },
  ...over,
});

function setup({ status = "Closed", full = FULL(), fetchImpl, secret = SECRET, notify = NOTIFY, tickets, dbOpts } = {}) {
  const db = memDb({ tickets: tickets ?? [{ id: 7, ticketdate: "2026-10-02", description: "Print button", status, createdat: "x" }] }, dbOpts);
  const fetched = [];
  const fetchFn = fetchImpl ?? (async (url, init) => { fetched.push({ url, auth: init.headers.authorization }); return { ok: true, status: 200, json: async () => full }; });
  const deps = { secret: secret ?? undefined, notifyEmail: notify ?? undefined, replyDomain: DOMAIN, apiKey: "re_full", apiUrl: "https://mail.test/", db: () => db, fetchFn, now: () => NOW_S * 1000 };
  const post = (body, headers = signed(body)) => handleInbound(body, headers, deps);
  return { db, fetched, post, deps };
}
const msgs = (db) => db.tables.ticket_messages ?? [];
const status = (db) => db.tables.tickets[0].status;

test("good reply: fetches the body with the key, stores it (quote stripped, author 'email'), moves the ticket to In review", async () => {
  const s = setup();
  const r = await s.post(EVENT());
  assert.deepEqual(r, { status: 200, note: "ticket 7 in review", emailId: "em_1" });
  assert.deepEqual(s.fetched, [{ url: "https://mail.test/emails/receiving/em_1", auth: "Bearer re_full" }]);
  assert.equal(msgs(s.db).length, 1);
  assert.deepEqual({ ticketid: msgs(s.db)[0].ticketid, author: msgs(s.db)[0].author, body: msgs(s.db)[0].body, rid: msgs(s.db)[0].resend_email_id }, { ticketid: 7, author: "email", body: "Looks fixed, thanks.", rid: "em_1" });
  assert.equal(status(s.db), "In review", "a Closed ticket still goes to In review");
});

test("the status flip is not a second write: a failing ticket update cannot strand the reply (a retry finds it stored AND In review)", async () => {
  const s = setup({ status: "Open", dbOpts: { updateError: { message: "tickets update fails" } } });
  const r = await s.post(EVENT());
  assert.deepEqual(r, { status: 200, note: "ticket 7 in review", emailId: "em_1" });
  assert.equal(msgs(s.db).length, 1);
  assert.equal(status(s.db), "In review", "the ticket_reply_review trigger (emulated in fakedb) did the flip with the insert");
  assert.deepEqual(s.db.writes.filter((w) => w[0] === "update"), [], "handleInbound issues no update of its own");
});

test("an insert that fails leaves the status alone and answers 500 (the flip rides on the insert)", async () => {
  const s = setup({ status: "Open", dbOpts: { insertError: { message: "pg down" } } });
  assert.equal((await s.post(EVENT())).status, 500);
  assert.equal(status(s.db), "Open");
});

test("every outcome past the signature carries the email_id; a bad signature carries nothing", async () => {
  const s = setup({ status: "Open" });
  assert.equal((await s.post(EVENT({ from: "x@else.test" }))).emailId, "em_1");
  assert.equal((await s.post(EVENT({}, "email.sent"))).emailId, undefined, "other event types are ignored before the id is read");
  assert.equal((await s.post(EVENT({ email_id: undefined }))).emailId, undefined);
  assert.deepEqual(await s.post(EVENT(), signed(EVENT(), { signature: "v1,AAAA" })), { status: 401, note: "bad signature" });
});

test("bad signature -> 401, nothing fetched or written", async () => {
  const s = setup();
  const body = EVENT();
  for (const headers of [
    signed(body, { signature: sig("msg_1", NOW_S, body, Buffer.from("other-key")) }),
    signed(body, { signature: "v1,AAAA" }),
    signed(body, { signature: "" }),
    signed(body, { signature: null }),
    signed(body, { id: null }),
    signed(body, { timestamp: null }),
    signed(body, { signature: sig("msg_2", NOW_S, body) }), // signed for another message id
    signed(body, { signature: signed(body).signature.replace("v1", "v2") }), // unknown version
  ]) {
    assert.equal((await s.post(body, headers)).status, 401);
  }
  assert.equal((await s.post(body + " ", signed(body))).status, 401, "body changed after signing");
  assert.deepEqual({ fetched: s.fetched.length, calls: s.db.calls.length }, { fetched: 0, calls: 0 });
});

test("stale or future timestamp (> 300 s) -> 401; the edge of the window passes", async () => {
  const s = setup();
  const body = EVENT();
  for (const ts of [NOW_S - 301, NOW_S + 301, "abc", "-5", "1e9"]) {
    assert.equal((await s.post(body, { id: "msg_1", timestamp: String(ts), signature: sig("msg_1", ts, body) })).status, 401, String(ts));
  }
  assert.equal((await s.post(body, { id: "msg_1", timestamp: String(NOW_S - 300), signature: sig("msg_1", NOW_S - 300, body) })).status, 200);
});

test("unset or blank TICKET_INBOUND_SECRET fails closed, even for a signature made with an empty key", async () => {
  const body = EVENT();
  for (const secret of [null, "", "whsec_"]) { // null = unset (undefined would take setup's default)
    const s = setup({ secret });
    assert.equal((await s.post(body, signed(body, { signature: sig("msg_1", NOW_S, body, Buffer.alloc(0)) }))).status, 401);
    assert.equal((await s.post(body)).status, 401);
    assert.equal(s.db.calls.length, 0);
  }
});

test("a decoded key shorter than 16 bytes is rejected even with a correct signature; 16 bytes is accepted", () => {
  const body = EVENT();
  const check = (key) => verifySvix(`whsec_${key.toString("base64")}`, signed(body, { signature: sig("msg_1", NOW_S, body, key) }), body, NOW_S * 1000);
  assert.equal(check(Buffer.alloc(0)), false);
  assert.equal(check(Buffer.from("a".repeat(15))), false);
  assert.equal(check(Buffer.from("a".repeat(16))), true);
});

test("several signatures in the header: any valid one is enough", async () => {
  const body = EVENT();
  const s = setup();
  const header = `v1,AAAA ${signed(body).signature} v1,BBBB`;
  assert.equal((await s.post(body, signed(body, { signature: header }))).status, 200);
});

test("wrong sender is ignored with 200: nothing fetched, nothing stored, status unchanged", async () => {
  for (const from of ["someone@else.test", "evil@bcn-services.com", `x${NOTIFY}`, `${NOTIFY}.evil.test`, `Nate <someone@else.test>`, `"${NOTIFY}" <someone@else.test>`, 5, undefined]) {
    const s = setup({ status: "Open" });
    const r = await s.post(EVENT({ from }));
    assert.equal(r.status, 200, String(from));
    assert.deepEqual({ fetched: s.fetched.length, msgs: msgs(s.db).length, st: status(s.db) }, { fetched: 0, msgs: 0, st: "Open" }, String(from));
  }
});

test("sender in 'Name <addr>' form, any case, is accepted", async () => {
  const s = setup({ status: "Open" });
  assert.equal((await s.post(EVENT({ from: `Nate Seluga <${NOTIFY.toUpperCase()}>` }))).note, "ticket 7 in review");
  assert.equal(status(s.db), "In review");
});

test("the fetched message is the authority: a different From there is ignored; TICKET_NOTIFY_EMAIL unset ignores everything", async () => {
  const s = setup({ status: "Open", full: FULL({ from: "spoof@else.test" }) });
  assert.match((await s.post(EVENT())).note, /^ignored/);
  assert.deepEqual({ msgs: msgs(s.db).length, st: status(s.db) }, { msgs: 0, st: "Open" });
  const none = setup({ status: "Open", notify: null });
  assert.match((await none.post(EVENT())).note, /^ignored/);
  assert.equal(none.fetched.length, 0);
});

test("authentication: needs DMARC or DKIM pass; missing, null, fail, gray or unknown is ignored", async () => {
  for (const authentication of [undefined, null, {}, { spf: "pass", dkim: "fail", dmarc: "fail" }, { spf: "pass", dkim: "gray", dmarc: "gray" }, { spf: "pass", dkim: "unknown", dmarc: "processing_failed" }]) {
    const s = setup({ status: "Open", full: FULL({ authentication }) });
    const r = await s.post(EVENT());
    assert.deepEqual({ st: r.status, n: msgs(s.db).length, s: status(s.db) }, { st: 200, n: 0, s: "Open" }, JSON.stringify(authentication));
  }
  for (const authentication of [{ spf: "fail", dkim: "pass", dmarc: "gray" }, { spf: "gray", dkim: "gray", dmarc: "pass" }]) {
    const s = setup({ status: "Open", full: FULL({ authentication }) });
    assert.equal((await s.post(EVENT())).note, "ticket 7 in review", JSON.stringify(authentication));
  }
});

test("recipient: ticket id comes from to or received_for on the reply domain only", async () => {
  for (const to of [[`t7@other.resend.app`], ["t7@bcn-services.com"], ["support@" + DOMAIN], [`7@${DOMAIN}`], [`tx@${DOMAIN}`], [`t0@${DOMAIN}`], []]) {
    const s = setup({ status: "Open" });
    assert.match((await s.post(EVENT({ to }))).note, /^ignored/, JSON.stringify(to));
    assert.equal(msgs(s.db).length, 0);
  }
  const s = setup({ status: "Open", full: FULL({ to: ["x@else.test"], received_for: [`T7@${DOMAIN.toUpperCase()}`] }) });
  assert.equal((await s.post(EVENT({ to: ["x@else.test"], received_for: [`T7@${DOMAIN.toUpperCase()}`] }))).note, "ticket 7 in review");
});

test("unknown ticket id is ignored without an insert", async () => {
  const s = setup({ full: FULL({ to: [`t99@${DOMAIN}`] }) });
  assert.equal((await s.post(EVENT({ to: [`t99@${DOMAIN}`] }))).note, "ignored: no such ticket");
  assert.equal(msgs(s.db).length, 0);
});

test("duplicate email_id: second delivery is a 200 no-op (one message; a later Reopen is not undone)", async () => {
  const s = setup({ status: "Open" });
  await s.post(EVENT());
  assert.equal(status(s.db), "In review");
  s.db.tables.tickets[0].status = "Open"; // staff reopened in between
  const again = await s.post(EVENT());
  assert.deepEqual(again, { status: 200, note: "duplicate", emailId: "em_1" });
  assert.equal(msgs(s.db).length, 1);
  assert.equal(status(s.db), "Open");
  // a different email id for the same ticket is a new message
  assert.equal((await s.post(EVENT({ email_id: "em_2" }))).status, 200);
  assert.equal(msgs(s.db).length, 2);
});

test("other events, junk bodies and missing email_id are 200 no-ops", async () => {
  const s = setup();
  for (const body of [EVENT({}, "email.sent"), EVENT({ email_id: undefined }), "not json", "{}", "null"]) {
    const r = await s.post(body);
    assert.equal(r.status, 200, body);
    assert.match(r.note, /^ignored/);
  }
  assert.deepEqual({ fetched: s.fetched.length, calls: s.db.calls.length }, { fetched: 0, calls: 0 });
});

test("transient failures answer 500 so Resend retries: fetch non-2xx, fetch throws, no API key, db insert error", async () => {
  for (const fetchImpl of [async () => ({ ok: false, status: 502 }), async () => { throw new Error("socket hang up"); }]) {
    const s = setup({ fetchImpl });
    assert.equal((await s.post(EVENT())).status, 500);
    assert.equal(msgs(s.db).length, 0);
  }
  const s = setup();
  assert.equal((await handleInbound(EVENT(), signed(EVENT()), { ...s.deps, apiKey: undefined })).status, 500);
  const bad = setup();
  bad.db.from = () => { throw new Error("pg down"); };
  assert.equal((await bad.post(EVENT())).status, 500);
});

test("empty reply (only a quote, or blank) is ignored; html is used when text is null", async () => {
  const quoteOnly = setup({ status: "Open", full: FULL({ text: "> just a quote\n> more" }) });
  assert.equal((await quoteOnly.post(EVENT())).note, "ignored: empty reply");
  assert.equal(status(quoteOnly.db), "Open");
  const html = setup({ status: "Open", full: FULL({ text: null, html: "<div>Please <b>reopen</b> it &amp; retest</div><br>On Tue, Oct 21 at 3 PM Bot wrote:<br><blockquote>old</blockquote>" }) });
  await html.post(EVENT());
  assert.equal(msgs(html.db)[0].body, "Please reopen it & retest");
});

test("stripQuoted: cuts at the first quote marker, keeps everything above", () => {
  assert.equal(stripQuoted("Fixed.\n\nOn Tue, Oct 21, 2026 at 3:00 PM Bot <b@x.test> wrote:\n> old"), "Fixed.");
  assert.equal(stripQuoted("Fixed.\n\nOn Tue, Oct 21, 2026 at 3:00 PM Some Long Name\n<b@x.test> wrote:\n> old"), "Fixed.");
  assert.equal(stripQuoted("Line one\nLine two\n> quoted\nmore"), "Line one\nLine two");
  assert.equal(stripQuoted("On Monday I will check it.\nThanks"), "On Monday I will check it.\nThanks");
  assert.equal(stripQuoted("  plain reply  "), "plain reply");
  assert.equal(stripQuoted("ok\n-----Original Message-----\nFrom: x"), "ok");
});

test("bareAddress / ticketIdFrom", () => {
  assert.equal(bareAddress("Nate <Me@X.test>"), "me@x.test");
  assert.equal(bareAddress(" me@x.test "), "me@x.test");
  assert.equal(ticketIdFrom(["a@b.test", `Bot <t12@${DOMAIN}>`], DOMAIN), 12);
  assert.equal(ticketIdFrom([`t12@${DOMAIN}.evil.test`], DOMAIN), null);
});

test("verifySvix against a published Svix test vector", () => {
  const body = '{"test": 2432232314}';
  const secret = "whsec_MfKQ9r8GKYqrTwjUPD8ILPZIo2LaLaSw";
  const h = { id: "msg_p5jXN8AQM9LWM0D4loKWxJek", timestamp: "1614265330", signature: "v1,g0hM9SsE+OTPJTGt/tmIKtSyZlE3uFJELVlNIOLJ1OE=" };
  assert.equal(verifySvix(secret, h, body, 1614265330_000), true);
  assert.equal(verifySvix(secret, h, body + "x", 1614265330_000), false);
  assert.equal(verifySvix(secret, h, body, 1614265330_000 + 301_000), false);
});
