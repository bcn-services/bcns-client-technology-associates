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
  return {
    tables, log,
    from(table) {
      const q = { filters: [], orders: [], update: null, del: false, single: false, range: null };
      const b = new Proxy({}, {
        get(_, k) {
          if (k === "then") {
            log.push([table, q.update ? "update" : "select"]);
            const all = (tables[table] ??= []);
            let rows = all.filter((r) => q.filters.every((f) => f(r)));
            if (q.update) for (const r of rows) Object.assign(r, q.update);
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
  assert.match(c.headers["idempotency-key"], new RegExp(`^bill-${B}-${TOKEN}-[0-9a-f]{32}$`));
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

test("provider unreachable (fetch throws) → provider error, nothing recorded", async () => {
  reset();
  const db = world();
  const r = await send(db, form(), { fetch: async () => { throw new TypeError("fetch failed"); } });
  assert.equal(r.state.code, "provider");
  assert.match(r.state.message, /no answer from the email service \(fetch failed\)/);
  assert.deepEqual(sentCols(db), [null, null]);
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
