// QA (independent of the engineer's send.test.mjs) for item 5 Preview-then-Send: runSend + sendWithGuard over an
// in-memory PostgREST fake and a LOCAL Resend stub HTTP server (random port). The real Resend API is never called and
// no real key is set. Every name and address is invented (@example.test).
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { randomBytes, randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

globalThis.React = React;
const rdom = createRequire(import.meta.url)("react-dom");
rdom.useFormStatus = () => ({ pending: false });
rdom.useFormState = (_a, init) => [init, () => {}];
const { runSend, loadSend, billEmailDraft } = await import("../../lib/bills/send.ts");
const { readStoredFile } = await import("../../lib/bill-docs/send.ts");
const { requireSession } = await import("../../lib/auth/session.ts");
const { SendForm } = await import("../../app/bills/[id]/send/send-form.tsx");
const { BillView } = await import("../../app/bills/[id]/bill-view.tsx");
const { loadBill } = await import("../../lib/bills/edit.ts");

/** PostgREST-shaped fake: eq / is / in filters, update(...).select() returns the updated rows; each await is atomic. */
function memDb(tables) {
  const writes = [];
  return {
    tables, writes,
    from(table) {
      const st = { f: [], upd: null, one: false };
      const chain = new Proxy({}, {
        get(_, k) {
          if (k === "then") {
            const rows = (tables[table] ??= []).filter((r) => st.f.every((fn) => fn(r)));
            if (st.upd) { for (const r of rows) Object.assign(r, st.upd); writes.push([table, st.upd, rows.length]); }
            const data = st.one ? (rows[0] ? { ...rows[0] } : null) : rows.map((r) => ({ ...r }));
            return (ok, bad) => Promise.resolve({ data, error: null }).then(ok, bad);
          }
          return (...a) => {
            if (k === "eq") st.f.push((r) => r[a[0]] === a[1]);
            else if (k === "is") st.f.push((r) => (r[a[0]] ?? null) === a[1]);
            else if (k === "in") st.f.push((r) => a[1].includes(r[a[0]]));
            else if (k === "update") st.upd = a[0];
            else if (k === "maybeSingle" || k === "single") st.one = true;
            return chain;
          };
        },
      });
      return chain;
    },
  };
}

// Local Resend stub + a local "storage" server that serves the stored PDF bytes at a signed URL.
let stub, stubUrl, hits = [], answer = () => [200, { id: "qa-stub" }];
let store, storeUrl;
const STORED = Buffer.concat([Buffer.from("%PDF-1.7\n"), randomBytes(4096), Buffer.from("\n%%EOF")]); // binary, non-UTF8
before(async () => {
  stub = createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => { raw += c; });
    req.on("end", () => {
      hits.push({ method: req.method, path: req.url, headers: req.headers, body: JSON.parse(raw || "{}") });
      const [status, payload] = answer();
      res.writeHead(status, { "content-type": typeof payload === "string" ? "text/plain" : "application/json" })
        .end(typeof payload === "string" ? payload : JSON.stringify(payload));
    });
  });
  store = createServer((req, res) => {
    if (req.url?.startsWith("/signed/")) res.writeHead(200, { "content-type": "application/pdf" }).end(STORED);
    else res.writeHead(404).end();
  });
  await Promise.all([stub, store].map((s) => new Promise((r) => s.listen(0, "127.0.0.1", r))));
  stubUrl = `http://127.0.0.1:${stub.address().port}`;
  storeUrl = `http://127.0.0.1:${store.address().port}`;
});
after(() => { stub?.close(); store?.close(); });
const fresh = () => { hits = []; answer = () => [200, { id: "qa-stub" }]; };

const CASE = 993771, BID = 7731, KEY = `bills/${CASE}/Bill${CASE} Quillfeather 2026 09 10-0.pdf`;
const storage = { getSignedUrl: async (k, ttl) => { assert.equal(k, KEY); assert.ok(ttl > 0); return `${storeUrl}/signed/${encodeURIComponent(k)}`; } };
const row = (o = {}) => ({
  billid: BID, billcaseid: CASE, billdate: "2026-09-10", billhours: 0, billbalance: "900.00", billnotice: "1st", billtype: "timesheet",
  billfinalizedat: "2026-09-29T12:00:00.000+00:00", supersedesbillid: null, billfilename: `Bill${CASE} Quillfeather 2026 09 10-0`,
  billpdfpath: KEY, billsentat: null, billsentto: null, billreports: null, billpaiddate: null, billestimate: false,
  billpriority: null, billcomments: null, billsecondnoticedate: null, billfinalnoticedate: null, ...o,
});
const seed = (o = {}) => memDb({
  tblbills: [row(o.bill)],
  tblcase: [{ caseid: CASE, casetitle: "Madeup v. Placeholder", casecaption: "Court of Fixtures No. QA-9", caseatty: 77, billingalert: false, billingcc: "clerk@example.test", ...o.kase }],
  tblattorney: [{ attyid: 77, attyemail: "quill@example.test", attylastname: "Quillfeather" }],
  tblbilllines: o.lines ?? [{ billid: BID, lineno: 1, kind: "charge", linedate: "2026-09-01", description: "Review", personid: null, hours: null, rate: null, amount: "900.00" }],
  tblbillingnames: [], tblactivity: [],
});
const who = (role) => ({
  auth: { getUser: async () => ({ data: { user: { id: "qa-user", email: "qa@example.test" } } }) },
  from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { role, personid: null } }) }) }) }),
});
const cfg = (o = {}) => ({ apiKey: "re_test_stub", apiUrl: stubUrl, from: "bills@example.test", ...o });
const fd = (o = {}) => {
  const f = new FormData();
  for (const [k, v] of Object.entries({ token: randomUUID(), sentat: "", to: "x@example.test", cc: "", bcc: "", subject: "S", body: "B", ...o })) f.set(k, v);
  return f;
};
/** Drive the action; counts PDF reads and DB-factory calls. */
async function act(db, f, o = {}) {
  const seen = { url: null, reads: 0, dbCalls: 0, state: null };
  try {
    seen.state = await runSend(o.id ?? BID, f, {
      session: () => requireSession("admin", who(o.role ?? "admin")),
      db: () => { seen.dbCalls++; return db; },
      now: () => o.now ?? new Date("2026-09-30T14:00:00.000Z"),
      config: () => o.config ?? cfg(),
      readPdf: async (k) => { seen.reads++; return readStoredFile(storage, k); },
      revalidatePath: () => {},
      redirect: (u) => { seen.url = u; throw Object.assign(new Error("NEXT_REDIRECT"), { digest: "NEXT_REDIRECT" }); },
    });
  } catch (e) { if (e.message !== "NEXT_REDIRECT") throw e; }
  return seen;
}
const sent = (db) => { const b = db.tables.tblbills[0]; return [b.billsentat, b.billsentto]; };

test("QA-1 edited preview: provider gets the EDITED To/CC/subject/body (not the pre-fill) + the stored PDF bytes; billsentat/billsentto set", async () => {
  fresh();
  const db = seed();
  const draft = billEmailDraft(await loadSend(db, BID), "office@example.test");
  assert.equal(draft.to, "quill@example.test");
  assert.equal(draft.cc, "office@example.test, clerk@example.test");
  assert.equal(draft.subject, "Re: Court of Fixtures No. QA-9");
  assert.match(draft.body, /^Atty\. Quillfeather,\n\nPlease see the attached invoice/);
  const edited = { to: "edit-to@example.test; second@example.test", cc: "edit-cc@example.test", subject: "Re: EDITED subject line", body: "EDITED body\n\n— QA" };
  for (const k of ["to", "cc", "subject", "body"]) assert.notEqual(edited[k], draft[k], k);
  const r = await act(db, fd(edited));
  assert.equal(r.url, `/bills/${BID}/send?sent=1`, JSON.stringify(r.state));
  assert.equal(hits.length, 1);
  const h = hits[0];
  assert.equal(h.method, "POST");
  assert.equal(h.path, "/emails");
  assert.equal(h.headers.authorization, "Bearer re_test_stub");
  assert.ok(h.headers["idempotency-key"], "idempotency key sent");
  assert.equal(h.body.from, "bills@example.test");
  assert.deepEqual(h.body.to, ["edit-to@example.test", "second@example.test"]);
  assert.deepEqual(h.body.cc, ["edit-cc@example.test"]);
  assert.equal(h.body.subject, "Re: EDITED subject line");
  assert.equal(h.body.text, "EDITED body\n\n— QA");
  assert.equal(h.body.attachments?.length, 1);
  assert.match(h.body.attachments[0].filename, /\.pdf$/);
  assert.ok(Buffer.from(h.body.attachments[0].content, "base64").equals(STORED), "attachment bytes == stored object bytes");
  assert.deepEqual(sent(db), ["2026-09-30T14:00:00.000Z", "edit-to@example.test, second@example.test"]);
});

test("QA-2 double submit: same form twice concurrently, two previews (different tokens) concurrently, and a sequential resubmit → ONE provider call each time", async () => {
  fresh();
  const db1 = seed();
  const f = fd();
  const pair = await Promise.all([act(db1, f), act(db1, f)]);
  assert.equal(hits.length, 1, `same-form pair: ${JSON.stringify(pair.map((p) => p.state))}`);
  assert.equal(pair.filter((p) => p.url).length, 1);
  assert.equal((await act(db1, f)).state?.code, "stale", "sequential resubmit");
  assert.equal(hits.length, 1);

  fresh();
  const db2 = seed();
  const trio = await Promise.all([act(db2, fd({ to: "a@example.test" })), act(db2, fd({ to: "b@example.test" })), act(db2, fd({ to: "c@example.test" }))]);
  assert.equal(hits.length, 1, `three tabs: ${JSON.stringify(trio.map((p) => p.state))}`);
  assert.equal(trio.filter((p) => p.url).length, 1);
  assert.deepEqual(sent(db2)[1], hits[0].body.to.join(", "), "recorded To matches the one message sent");
});

test("QA-3 staff: refused as forbidden — no DB, no PDF read, no provider call, nothing written", async () => {
  fresh();
  const db = seed();
  const r = await act(db, fd({ to: "x@example.test" }), { role: "staff" });
  assert.equal(r.state?.code, "forbidden");
  assert.equal(r.dbCalls, 0);
  assert.equal(r.reads, 0);
  assert.equal(r.url, null);
  assert.equal(hits.length, 0);
  assert.deepEqual(db.writes, []);
  assert.deepEqual(sent(db), [null, null]);
});

test("QA-4 no RESEND_API_KEY: action refuses quietly (no throw, no call, nothing written); form renders with Send disabled + plain message", async () => {
  fresh();
  const db = seed();
  const r = await act(db, fd(), { config: { apiUrl: stubUrl, from: "bills@example.test" } });
  assert.equal(r.state?.code, "email-off");
  assert.doesNotMatch(r.state.message, /error|exception|undefined/i);
  assert.equal(hits.length, 0);
  assert.deepEqual(db.writes, []);
  const html = renderToStaticMarkup(React.createElement(SendForm, {
    draft: billEmailDraft(await loadSend(db, BID), undefined), alert: false, emailOn: false, token: randomUUID(), sentat: "",
    pdfHref: `/bills/${BID}/pdf`, pdfName: "Bill1.pdf", action: async () => null,
  }));
  assert.match(html, /<button[^>]*disabled=""[^>]*>Send<\/button>/);
  assert.match(html, /not set up/i);
  assert.match(html, /<span>To<\/span><input name="to"[^>]*value="quill@example\.test"/);
  assert.match(html, /<a href="\/bills\/7731\/pdf"[^>]*>Bill1\.pdf<\/a>/);
});

test("QA-5 empty / malformed To (incl. header-injection shapes) refused before the PDF read and before Resend; nothing written", async () => {
  fresh();
  const bad = ["", " ", ",", ";;", "nobody", "a@", "@example.test", "a@example", "a b@example.test", "a@example..test", "a@.example.test",
    "Pat <pat@example.test>", "pat@example.test\r\nBcc: z@example.test", "ok@example.test, broken@", "a@exa mple.test"];
  for (const to of bad) {
    const db = seed();
    const r = await act(db, fd({ to }));
    assert.equal(r.state?.code, "to", JSON.stringify(to));
    assert.equal(r.reads, 0, JSON.stringify(to));
    assert.deepEqual(db.writes, [], JSON.stringify(to));
  }
  assert.equal(hits.length, 0);
});

test("QA-6 Resend 4xx / 5xx / non-JSON: bill NOT marked sent (first send and Send again), provider's error shown", async () => {
  for (const [status, payload, expect] of [
    [401, { statusCode: 401, name: "missing_api_key", message: "API key is invalid" }, /401 API key is invalid/],
    [429, { statusCode: 429, name: "rate_limit_exceeded", message: "Too many requests" }, /429 Too many requests/],
    [500, { statusCode: 500, name: "internal_server_error", message: "Resend fell over" }, /500 Resend fell over/],
    [502, "upstream bad gateway", /502 upstream bad gateway/],
  ]) {
    fresh();
    answer = () => [status, payload];
    const db = seed();
    const r = await act(db, fd());
    assert.equal(r.url, null, String(status));
    assert.equal(r.state?.code, "provider", String(status));
    assert.match(r.state.message, expect);
    assert.deepEqual(sent(db), [null, null], `${status}: never marked sent`);
    assert.equal(hits.length, 1);

    const prev = ["2026-09-15T09:00:00.000+00:00", "earlier@example.test"];
    const db2 = seed({ bill: { billsentat: prev[0], billsentto: prev[1] } });
    const r2 = await act(db2, fd({ sentat: prev[0] }));
    assert.equal(r2.state?.code, "provider");
    assert.deepEqual(sent(db2), prev, `${status}: Send again failure keeps the previous send`);
  }
});

test("QA-7 unfinalized / legacy bill: action refuses before Resend; legacy bill page shows no Send link", async () => {
  fresh();
  for (const [o, code] of [[{ billfinalizedat: null }, "unfinalized"], [{ billtype: null, billfinalizedat: null, billpdfpath: null }, "legacy"], [{ billtype: null }, "legacy"]]) {
    const db = seed({ bill: o });
    const r = await act(db, fd());
    assert.equal(r.state?.code, code, JSON.stringify(o));
    assert.equal(r.reads, 0);
    assert.deepEqual(db.writes, []);
  }
  assert.equal(hits.length, 0);
  const legacy = renderToStaticMarkup(React.createElement(BillView, {
    data: await loadBill(seed({ bill: { billtype: null, billfinalizedat: null, billpdfpath: null }, lines: [] }), BID), admin: true,
  }));
  assert.doesNotMatch(legacy, /\/send"|Email this bill|Email again/);
});

test("QA-8 recipient alert: Send disabled until ticked in the form; server refuses an unticked submit", async () => {
  fresh();
  const db = seed({ kase: { billingalert: true } });
  const html = renderToStaticMarkup(React.createElement(SendForm, {
    draft: billEmailDraft(await loadSend(db, BID), undefined), alert: true, emailOn: true, token: randomUUID(), sentat: "",
    pdfHref: "/x", pdfName: "x.pdf", action: async () => null,
  }));
  assert.match(html, /<button[^>]*disabled=""[^>]*>Send<\/button>/);
  assert.equal((await act(db, fd())).state?.code, "alert");
  assert.equal((await act(db, fd({ alertok: "0" }))).state?.code, "alert");
  assert.equal(hits.length, 0);
  assert.equal((await act(db, fd({ alertok: "1" }))).url, `/bills/${BID}/send?sent=1`);
  assert.equal(hits.length, 1);
});
