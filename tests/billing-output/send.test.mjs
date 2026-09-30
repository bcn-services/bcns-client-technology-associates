// Item 5: Preview-then-Send (lib/bills/send.ts + lib/bill-docs/send.ts) over a stateful fake PostgREST and a LOCAL
// Resend stub HTTP server (random port) — the real Resend API is never called and no real key is ever set.
// Synthetic fixtures; every name/address below is invented (@example.test).
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

globalThis.React = React;
const rdom = createRequire(import.meta.url)("react-dom");
rdom.useFormStatus = () => ({ pending: false });
rdom.useFormState = (_a, init) => [init, () => {}];
const { runSend, loadSend, billEmailDraft } = await import("../../lib/bills/send.ts");
const core = await import("../../lib/bill-docs/send.ts");
const { canSendBill } = await import("../../lib/bills/rules.ts");
const { requireSession } = await import("../../lib/auth/session.ts");
const { SendForm } = await import("../../app/bills/[id]/send/send-form.tsx");
const { BillView } = await import("../../app/bills/[id]/bill-view.tsx");
const { loadBill } = await import("../../lib/bills/edit.ts");

function fakeDb(tables, log = []) {
  const db = {
    tables, log,
    /** Optional test hook: (table) → "error" (update not applied, {error}) | "commit-error" (applied, then {error}). */
    onUpdate: null,
    from(table) {
      const q = { filters: [], orders: [], update: null, del: false, single: false, range: null };
      const b = new Proxy({}, {
        get(_, k) {
          if (k === "then") {
            log.push([table, q.update ? "update" : "select"]);
            const hook = q.update ? db.onUpdate?.(table) : undefined;
            const lost = (res, rej) => Promise.resolve({ data: null, error: { message: "update reply lost" } }).then(res, rej);
            if (hook === "error") return lost;
            const all = (tables[table] ??= []);
            let rows = all.filter((r) => q.filters.every((f) => f(r)));
            if (q.update) for (const r of rows) Object.assign(r, q.update);
            if (hook === "commit-error") return lost;
            for (const [col, asc] of [...q.orders].reverse()) rows = [...rows].sort((x, y) => (x[col] < y[col] ? -1 : x[col] > y[col] ? 1 : 0) * (asc ? 1 : -1));
            if (q.range) rows = rows.slice(q.range[0], q.range[1] + 1);
            const data = q.single ? (rows[0] ? { ...rows[0] } : null) : rows.map((r) => ({ ...r }));
            return (res, rej) => Promise.resolve({ data, error: null }).then(res, rej);
          }
          return (...a) => {
            if (k === "eq") q.filters.push((r) => r[a[0]] === a[1]);
            if (k === "is") q.filters.push((r) => (r[a[0]] ?? null) === a[1]);
            if (k === "in") q.filters.push((r) => a[1].includes(r[a[0]]));
            if (k === "order") q.orders.push([a[0], a[1]?.ascending !== false]);
            if (k === "range") q.range = a;
            if (k === "update") q.update = a[0];
            if (k === "maybeSingle" || k === "single") q.single = true;
            return b;
          };
        },
      });
      return b;
    },
  };
  return db;
}

// --- Resend stub: records every request; `reply` decides the response.
let stub, stubUrl, calls = [], reply = () => [200, { id: "stub-1" }];
before(async () => {
  stub = createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => { raw += c; });
    req.on("end", () => {
      calls.push({ method: req.method, url: req.url, headers: req.headers, body: JSON.parse(raw || "{}") });
      const [status, json] = reply();
      res.writeHead(status, { "content-type": "application/json" }).end(JSON.stringify(json));
    });
  });
  await new Promise((r) => stub.listen(0, "127.0.0.1", r));
  stubUrl = `http://127.0.0.1:${stub.address().port}`;
});
after(() => stub?.close());
const reset = () => { calls = []; reply = () => [200, { id: "stub-1" }]; };

const CASE = 992330, B = 830, PATH = `bills/${CASE}/Bill${CASE} Testwood 2026 09 07-0.pdf`;
const PDF = new TextEncoder().encode("%PDF-1.4 fake invoice bytes");
const LINE = { billid: B, lineno: 1, kind: "charge", linedate: "2026-08-01", description: "Flat fee", personid: null, hours: null, rate: null, amount: "500.00" };
const bill = (o = {}) => ({
  billid: B, billcaseid: CASE, billdate: "2026-09-07", billhours: 0, billbalance: "500.00", billnotice: "1st", billtype: "retainer",
  billfinalizedat: "2026-09-28T16:00:00.000+00:00", supersedesbillid: null, billfilename: `Bill${CASE} Testwood 2026 09 07-0`,
  billpdfpath: PATH, billsentat: null, billsentto: null, billreports: null, billpaiddate: null, billestimate: false,
  billpriority: null, billcomments: null, billsecondnoticedate: null, billfinalnoticedate: null, ...o,
});
const world = (o = {}) => fakeDb({
  tblbills: [bill(o.bill)],
  tblcase: [{ caseid: CASE, casetitle: "Invented v. Fixture", casecaption: "Superior Court of Nowhere No. X-1", caseatty: 41, billingalert: false, billingcc: "para@example.test", ...o.kase }],
  tblattorney: [{ attyid: 41, attyemail: "rowan@example.test", attylastname: "Testwood", ...o.atty }],
  tblbilllines: o.lines ?? [{ ...LINE }],
  tblbillingnames: [],
  tblactivity: [],
});
const sessionClient = (role) => ({
  auth: { getUser: async () => ({ data: { user: { id: "u1", email: "q@example.test" } } }) },
  from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { role, personid: null } }) }) }) }),
});
const CFG = () => ({ apiKey: "re_test_not_real", apiUrl: stubUrl, from: "billing@example.test" });
const TOKEN = "11111111-2222-4333-8444-555555555555";
const form = (o = {}) => {
  const f = new FormData();
  const v = { token: TOKEN, sentat: "", to: "pat@example.test", cc: "", bcc: "", subject: "Re: Edited subject", body: "Edited body\nline 2", ...o };
  for (const [k, x] of Object.entries(v)) if (x !== undefined) f.set(k, x);
  return f;
};
/** Run the action; returns { state, url (redirect), reads (readPdf calls) }. */
async function send(db, f = form(), o = {}) {
  let url = null, reads = 0;
  const deps = {
    session: () => requireSession("admin", sessionClient(o.role ?? "admin")),
    db: o.db ?? (() => db),
    now: () => o.now ?? new Date("2026-09-29T15:00:00.000Z"),
    config: o.config ?? CFG,
    readPdf: async (k) => { reads++; assert.equal(k, PATH); return PDF; },
    fetch: o.fetch,
    revalidatePath: () => {},
    redirect: (u) => { url = u; throw new Error("NEXT_REDIRECT"); },
  };
  let state;
  try { state = await runSend(o.id ?? B, f, deps); } catch (e) { if (e.message !== "NEXT_REDIRECT") throw e; }
  return { state, url, reads };
}
const getB = (db) => db.tables.tblbills.find((b) => b.billid === B);
const sentCols = (db) => [getB(db).billsentat, getB(db).billsentto];

test("parseAddresses: lists split on , ; space; blank → []; any malformed → null", () => {
  assert.deepEqual(core.parseAddresses(" a@example.test, b.c@sub.example.test;d@example.test "), ["a@example.test", "b.c@sub.example.test", "d@example.test"]);
  assert.deepEqual(core.parseAddresses("  "), []);
  for (const bad of ["pat", "pat@", "@example.test", "pat@example", "pat@@example.test", "a@example.test, nope", "<a@example.test>", "a@-x.test"]) {
    assert.equal(core.parseAddresses(bad), null, bad);
  }
  assert.equal(core.parseAddresses(Array.from({ length: 51 }, (_, i) => `p${i}@example.test`).join(",")), null, "over Resend's 50");
});

test("canSendBill: typed + finalized + PDF + intact + not closed", () => {
  const b = { billtype: "timesheet", billfinalizedat: "2026-09-28T00:00:00Z", billpdfpath: "bills/1/x.pdf", billnotice: "1st" };
  assert.equal(canSendBill(b, false), true);
  assert.equal(canSendBill({ ...b, billnotice: "Paid" }, false), true);
  assert.equal(canSendBill({ ...b, billtype: null }, false), false);
  assert.equal(canSendBill({ ...b, billfinalizedat: null }, false), false);
  assert.equal(canSendBill({ ...b, billpdfpath: null }, false), false);
  assert.equal(canSendBill(b, true), false);
  for (const n of ["Cancelled", "Carried Over", "Settled"]) assert.equal(canSendBill({ ...b, billnotice: n }, false), false, n);
});

test("preview pre-fill: To = attyemail, CC = BILL_CC_EMAIL + billingcc, Re: <caption>, the legacy body", async () => {
  const d = await loadSend(world(), B);
  assert.deepEqual(billEmailDraft(d, "office@example.test"), {
    to: "rowan@example.test",
    cc: "office@example.test, para@example.test",
    bcc: "",
    subject: "Re: Superior Court of Nowhere No. X-1",
    body: "Atty. Testwood,\n\nPlease see the attached invoice for the recent work on this case. Let me know if you have any questions.  Thank you.",
  });
  const bare = billEmailDraft(await loadSend(world({ kase: { billingcc: null, casecaption: null }, atty: { attyemail: null } }), B), undefined);
  assert.deepEqual([bare.to, bare.cc, bare.subject], ["", "", "Re: Invented v. Fixture"]);
});

test("happy path: one provider call with the EDITED To/CC/BCC/subject/body + the PDF; billsentat/billsentto set; → ?sent=1", async () => {
  reset();
  const db = world();
  const r = await send(db, form({ to: "pat@example.test, lee@example.test", cc: "cc1@example.test", bcc: "bcc@example.test" }));
  assert.equal(r.url, `/bills/${B}/send?sent=1`, JSON.stringify(r.state));
  assert.equal(calls.length, 1);
  const c = calls[0];
  assert.equal(c.method, "POST");
  assert.equal(c.url, "/emails");
  assert.equal(c.headers.authorization, "Bearer re_test_not_real");
  assert.match(c.headers["idempotency-key"], new RegExp(`^bill-${B}-none-[0-9a-f]{32}$`), "key scoped on bill state, not the render token");
  assert.deepEqual(
    { from: c.body.from, to: c.body.to, cc: c.body.cc, bcc: c.body.bcc, subject: c.body.subject, text: c.body.text },
    { from: "billing@example.test", to: ["pat@example.test", "lee@example.test"], cc: ["cc1@example.test"], bcc: ["bcc@example.test"], subject: "Re: Edited subject", text: "Edited body\nline 2" },
  );
  assert.equal(c.body.attachments.length, 1);
  assert.equal(c.body.attachments[0].filename, `Bill${CASE} Testwood 2026 09 07-0.pdf`);
  assert.deepEqual(Buffer.from(c.body.attachments[0].content, "base64"), Buffer.from(PDF));
  assert.deepEqual(sentCols(db), ["2026-09-29T15:00:00.000Z", "pat@example.test, lee@example.test"]);
});

test("double submit: two concurrent sends of one preview → ONE provider call; a later replay → stale, still one", async () => {
  reset();
  const db = world();
  const [a, b] = await Promise.all([send(db), send(db)]);
  assert.equal(calls.length, 1, "one provider call");
  const urls = [a.url, b.url].filter(Boolean);
  assert.deepEqual(urls, [`/bills/${B}/send?sent=1`]);
  assert.equal([a.state, b.state].find(Boolean).code, "stale");
  const replay = await send(db);
  assert.equal(replay.state.code, "stale");
  assert.equal(calls.length, 1);
});

test("staff → forbidden with no DB call and no provider call", async () => {
  reset();
  const r = await send(null, form(), { role: "staff", db: () => { throw new Error("db touched"); } });
  assert.equal(r.state.code, "forbidden");
  assert.equal(r.reads, 0);
  assert.equal(calls.length, 0);
});

test("no RESEND_API_KEY (or no From) → email-off state, nothing thrown, no provider call, nothing recorded", async () => {
  reset();
  for (const config of [() => ({ apiUrl: stubUrl, from: "billing@example.test" }), () => ({ apiKey: "re_test_not_real", apiUrl: stubUrl })]) {
    const db = world();
    const r = await send(db, form(), { config });
    assert.equal(r.state.code, "email-off");
    assert.match(r.state.message, /not set up/);
    assert.deepEqual(sentCols(db), [null, null]);
  }
  assert.equal(calls.length, 0);
  assert.equal(core.emailReady({ apiUrl: "x" }), false);
});

test("send form: no keys → Send disabled with a plain message; alert case → Send disabled until ticked; To/CC/Subject labels", () => {
  const props = { draft: { to: "a@example.test", cc: "", bcc: "", subject: "Re: X", body: "B" }, token: TOKEN, sentat: "", pdfHref: `/bills/${B}/pdf`, pdfName: "Bill1 X 2026 09 07-0.pdf", action: async () => null };
  const off = renderToStaticMarkup(React.createElement(SendForm, { ...props, alert: false, emailOn: false }));
  assert.match(off, /<button type="submit" disabled=""[^>]*>Send<\/button>/);
  assert.match(off, /Email is not set up yet, so Send is turned off/);
  const on = renderToStaticMarkup(React.createElement(SendForm, { ...props, alert: false, emailOn: true }));
  assert.match(on, /<button type="submit" class[^>]*>Send<\/button>/);
  assert.doesNotMatch(on, /not set up/);
  const alert = renderToStaticMarkup(React.createElement(SendForm, { ...props, alert: true, emailOn: true }));
  assert.match(alert, /<button type="submit" disabled=""[^>]*>Send<\/button>/);
  assert.match(alert, /name="alertok"/);
  for (const l of ["To", "CC", "BCC", "Subject", "Message"]) assert.match(on, new RegExp(`<span>${l}</span>`));
  assert.match(on, /<a href="\/bills\/830\/pdf"[^>]*>Bill1 X 2026 09 07-0\.pdf<\/a>/);
});

test("refused before any side work: unfinalized, legacy, no PDF, closed, broken, bad id — no PDF read, no provider call", async () => {
  reset();
  const cases = [
    [{ billfinalizedat: null }, "unfinalized"],
    [{ billtype: null, billfinalizedat: null }, "legacy"],
    [{ billpdfpath: null }, "nopdf"],
    [{ billnotice: "Cancelled" }, "closed"],
  ];
  for (const [o, code] of cases) {
    const db = world({ bill: o });
    const r = await send(db);
    assert.equal(r.state?.code, code, code);
    assert.equal(r.reads, 0, code);
    assert.deepEqual(sentCols(db), [null, null]);
  }
  const broken = world({ lines: [] });
  assert.equal((await send(broken)).state.code, "broken");
  assert.equal((await send(world(), form(), { id: 0 })).state.code, "notfound");
  assert.equal((await send(world(), form(), { id: 999 })).state.code, "notfound");
  assert.equal(calls.length, 0);
});

test("empty or malformed To (and bad CC/BCC) → refused before the PDF read and before Resend; nothing recorded", async () => {
  reset();
  for (const [o, code] of [[{ to: "" }, "to"], [{ to: "   " }, "to"], [{ to: "not-an-address" }, "to"], [{ to: "a@example.test, b@" }, "to"],
    [{ cc: "x@" }, "cc"], [{ bcc: "y" }, "bcc"], [{ subject: " \n " }, "subject"], [{ body: "  " }, "body"]]) {
    const db = world();
    const r = await send(db, form(o));
    assert.equal(r.state?.code, code, JSON.stringify(o));
    assert.equal(r.reads, 0, JSON.stringify(o));
    assert.deepEqual(sentCols(db), [null, null]);
  }
  assert.equal(calls.length, 0);
});

test("core guard: sendWithGuard itself refuses an empty/malformed To without claiming or calling the provider", async () => {
  reset();
  let claimed = 0;
  const guard = { claim: async () => { claimed++; return true; }, release: async () => {} };
  const mail = (to) => ({ to, cc: [], bcc: [], subject: "s", text: "t", attachment: { filename: "a.pdf", content: PDF } });
  for (const to of [[], ["bad"], ["a@example.test", "b@"]]) {
    await assert.rejects(core.sendWithGuard(CFG(), mail(to), guard, "tok"), (e) => e.code === "to");
  }
  await assert.rejects(core.sendWithGuard({ apiUrl: stubUrl }, mail(["a@example.test"]), guard, "tok"), (e) => e.code === "email-off");
  assert.equal(claimed, 0);
  assert.equal(calls.length, 0);
});

test("recipient alert: unticked → refused, no call; ticked → sent", async () => {
  reset();
  const db = world({ kase: { billingalert: true } });
  assert.equal((await send(db)).state.code, "alert");
  assert.equal(calls.length, 0);
  assert.equal((await send(db, form({ alertok: "1" }))).url, `/bills/${B}/send?sent=1`);
  assert.equal(calls.length, 1);
});

test("Resend failure: provider's error shown, NOTHING recorded (first send and a Send again both roll back)", async () => {
  reset();
  reply = () => [422, { statusCode: 422, name: "validation_error", message: "The example.test domain is not verified." }];
  const db = world();
  const r = await send(db);
  assert.equal(r.url, null);
  assert.equal(r.state.code, "provider");
  assert.match(r.state.message, /Nothing was sent[\s\S]*422 The example\.test domain is not verified\./);
  assert.deepEqual(sentCols(db), [null, null], "never marked sent");

  const prior = ["2026-09-20T10:00:00.000+00:00", "old@example.test"];
  const db2 = world({ bill: { billsentat: prior[0], billsentto: prior[1] } });
  const r2 = await send(db2, form({ sentat: prior[0] }));
  assert.equal(r2.state.code, "provider");
  assert.deepEqual(sentCols(db2), prior, "Send again failure restores the previous send");
  assert.equal(calls.length, 2);
});

test("no answer (fetch throws / timeout) → its own 'may have been sent' code, bill released so an unchanged resend is deduped", async () => {
  reset();
  for (const err of [new TypeError("fetch failed"), new DOMException("The operation was aborted due to timeout", "TimeoutError")]) {
    const db = world();
    const r = await send(db, form(), { fetch: async () => { throw err; } });
    assert.equal(r.state.code, "noanswer");
    assert.match(r.state.message, /didn't answer — it may have been sent[\s\S]*resending it unchanged[\s\S]*will not send twice/);
    assert.doesNotMatch(r.state.message, /Nothing was sent/);
    assert.deepEqual(sentCols(db), [null, null], "released: the key's scope (billsentat) is unchanged for the retry");
  }
});

/** A fetch that records the Idempotency-Key and then fails the way `mode` says ("drop" = no answer). */
const keyed = (keys, mode) => async (url, init) => {
  keys.push(init.headers["idempotency-key"]);
  if (mode === "drop") throw new TypeError("fetch failed");
  return fetch(url, init);
};

test("retry after a lost answer reuses the SAME Idempotency-Key: same preview, and a reload (new token, same state + payload)", async () => {
  reset();
  const db = world();
  const keys = [];
  const f = form();
  assert.equal((await send(db, f, { fetch: keyed(keys, "drop") })).state.code, "noanswer");
  assert.equal((await send(db, f, { fetch: keyed(keys, "drop") })).state.code, "noanswer", "same preview retried");
  const reload = form({ token: "99999999-8888-4777-8666-555555555555" });
  assert.equal((await send(db, reload, { fetch: keyed(keys) })).url, `/bills/${B}/send?sent=1`, "reload-style retry");
  assert.equal(keys.length, 3);
  assert.equal(keys[0], keys[1]);
  assert.equal(keys[0], keys[2]);
  assert.equal(calls.at(-1).headers["idempotency-key"], keys[0], "the key actually reached the provider");
});

test("a changed payload (or a later Send again) gets a DIFFERENT Idempotency-Key", async () => {
  reset();
  const keys = [];
  await send(world(), form(), { fetch: keyed(keys, "drop") });
  await send(world(), form({ body: "Edited body, changed" }), { fetch: keyed(keys, "drop") });
  await send(world(), form({ cc: "extra@example.test" }), { fetch: keyed(keys, "drop") });
  const prior = "2026-09-20T10:00:00.000+00:00";
  await send(world({ bill: { billsentat: prior, billsentto: "old@example.test" } }), form({ sentat: prior }), { fetch: keyed(keys, "drop") });
  assert.equal(new Set(keys).size, 4, JSON.stringify(keys));
  assert.match(keys[3], new RegExp(`^bill-${B}-${prior.replace(/[.+]/g, "\\$&")}-[0-9a-f]{32}$`));
});

/** world() whose tblbills updates follow `plan` in order ("ok" | "error" | "commit-error"); counts them. */
function flakyWorld(plan) {
  const db = world();
  db.updates = 0;
  db.onUpdate = (t) => (t === "tblbills" ? plan[db.updates++] ?? "ok" : "ok");
  return db;
}

test("claim write errors → the compensating release runs, no provider call, 'failed'", async () => {
  reset();
  const db = flakyWorld(["commit-error"]); // the claim committed but its reply was lost
  const r = await send(db);
  assert.equal(r.state.code, "failed", JSON.stringify(r.state));
  assert.equal(db.updates, 2, "claim + compensating release");
  assert.deepEqual(sentCols(db), [null, null], "the committed claim was undone");
  assert.equal(calls.length, 0);
});

test("claim errors AND its release fails → code 'release' (reload and check), not 'nothing recorded'; no provider call", async () => {
  reset();
  const db = flakyWorld(["commit-error", "error"]);
  const r = await send(db);
  assert.equal(r.state.code, "release");
  assert.match(r.state.message, /reload and check its sent status/);
  assert.doesNotMatch(r.state.message, /Nothing was recorded/);
  assert.equal(calls.length, 0);
});

test("provider failure and the release fails → code 'release'", async () => {
  reset();
  reply = () => [500, { message: "boom" }];
  const db = flakyWorld(["ok", "error"]);
  const r = await send(db);
  assert.equal(r.state.code, "release");
  assert.equal(calls.length, 1);
});

test("core checkEmail: caps per field, CR/LF folded, empty/oversize subject and body refused — for every caller", async () => {
  const ok = { to: ["a@example.test"], cc: [], bcc: [], subject: "Re: x\r\nBcc: evil@example.test", text: "t" };
  assert.equal(core.checkEmail(ok).subject, "Re: x Bcc: evil@example.test");
  const many = Array.from({ length: 51 }, (_, i) => `p${i}@example.test`);
  for (const [o, code] of [[{ to: many }, "to"], [{ cc: many }, "cc"], [{ bcc: many }, "bcc"], [{ cc: ["x@"] }, "cc"], [{ to: [] }, "to"],
    [{ subject: " \r\n " }, "subject"], [{ subject: "s".repeat(999) }, "subject"], [{ text: " \n" }, "body"], [{ text: "b".repeat(50_001) }, "body"]]) {
    assert.throws(() => core.checkEmail({ ...ok, ...o }), (e) => e.code === code, JSON.stringify(o).slice(0, 60));
  }
  reset();
  let claimed = 0;
  const guard = { claim: async () => { claimed++; return true; }, release: async () => {} };
  const att = { filename: "a.pdf", content: PDF };
  await assert.rejects(core.sendWithGuard(CFG(), { ...ok, subject: "\n", attachment: att }, guard, "s"), (e) => e.code === "subject");
  await assert.rejects(core.sendWithGuard(CFG(), { ...ok, cc: many, attachment: att }, guard, "s"), (e) => e.code === "cc");
  assert.equal(claimed, 0);
  await core.sendWithGuard(CFG(), { ...ok, attachment: att }, guard, "s");
  assert.equal(calls[0].body.subject, "Re: x Bcc: evil@example.test", "the provider gets the one-line subject");
});

test("Send again: a sent bill re-sends from a new preview (its sentat), a stale preview (old sentat / bad token) is refused", async () => {
  reset();
  const prior = "2026-09-20T10:00:00.000+00:00";
  const db = world({ bill: { billsentat: prior, billsentto: "old@example.test" } });
  assert.equal((await send(db)).state.code, "stale", "preview rendered before the first send");
  assert.equal((await send(db, form({ sentat: prior, token: "nope" }))).state.code, "stale");
  assert.equal(calls.length, 0);
  assert.equal((await send(db, form({ sentat: prior, to: "new@example.test" }))).url, `/bills/${B}/send?sent=1`);
  assert.deepEqual(sentCols(db), ["2026-09-29T15:00:00.000Z", "new@example.test"]);
  assert.equal(calls.length, 1);
});

test("bill page: 'Sent <date> to <addr>' for everyone; Email link for admins on a sendable bill only; legacy shows neither", async () => {
  const html = async (o, admin, lines) => renderToStaticMarkup(React.createElement(BillView, { data: await loadBill(world({ bill: o, lines }), B), admin }));
  const sent = { billsentat: "2026-09-29T15:00:00.000Z", billsentto: "pat@example.test" };
  assert.match(await html(sent, false), /data-testid="bill-sent"[^>]*>Sent 2026-09-29 to pat@example\.test/);
  assert.doesNotMatch(await html(sent, false), /bill-send"/);
  assert.match(await html(sent, true), /href="\/bills\/830\/send\?again=1"[^>]*>Email again/);
  assert.match(await html({}, true), /href="\/bills\/830\/send"[^>]*>Email this bill/);
  assert.doesNotMatch(await html({ billpdfpath: null }, true), /bill-send"/);
  const legacy = await html({ billtype: null, billfinalizedat: null, billpdfpath: null }, true, []);
  assert.doesNotMatch(legacy, /bill-send"|bill-sent"/);
});
