// QA (delta, item 5 fix pass): Resend Idempotency-Key behavior after a lost answer. runSend over an in-memory PostgREST
// fake and a LOCAL Resend stub (random port) that records every Idempotency-Key and can accept-then-drop the response
// (hang past the timeout, or destroy the socket after reading the body). The stub also models Resend's key dedupe
// (same key → same id, no second delivery). Never calls Resend; every address is @example.test.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { randomBytes, randomUUID } from "node:crypto";

const { runSend, loadSend, billEmailDraft } = await import("../../lib/bills/send.ts");
const { readStoredFile } = await import("../../lib/bill-docs/send.ts");
const { requireSession } = await import("../../lib/auth/session.ts");

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

// mode: "ok" answers; "hang" reads the body, records it (accepted) and never answers; "drop" records it then destroys the socket.
let stub, stubUrl, store, storeUrl, hits = [], delivered = new Map(), mode = "ok";
const STORED = Buffer.concat([Buffer.from("%PDF-1.7\n"), randomBytes(2048), Buffer.from("\n%%EOF")]);
before(async () => {
  stub = createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => { raw += c; });
    req.on("end", () => {
      const key = req.headers["idempotency-key"];
      hits.push({ key, body: JSON.parse(raw || "{}"), mode });
      if (!delivered.has(key)) delivered.set(key, `id-${delivered.size + 1}`); // accepted: Resend delivers once per key
      if (mode === "hang") return;
      if (mode === "drop") return req.socket.destroy();
      res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ id: delivered.get(key) }));
    });
  });
  store = createServer((req, res) => res.writeHead(200, { "content-type": "application/pdf" }).end(STORED));
  await Promise.all([stub, store].map((s) => new Promise((r) => s.listen(0, "127.0.0.1", r))));
  stubUrl = `http://127.0.0.1:${stub.address().port}`;
  storeUrl = `http://127.0.0.1:${store.address().port}`;
});
after(() => { stub?.closeAllConnections(); stub?.close(); store?.close(); });
const fresh = () => { hits = []; delivered = new Map(); mode = "ok"; };

const CASE = 993781, BID = 7781, KEY = `bills/${CASE}/Bill${CASE} Inkwell 2026 09 10-0.pdf`;
const storage = { getSignedUrl: async (k) => `${storeUrl}/signed/${encodeURIComponent(k)}` };
const seed = (bill = {}) => memDb({
  tblbills: [{
    billid: BID, billcaseid: CASE, billdate: "2026-09-10", billhours: 0, billbalance: "500.00", billnotice: "1st", billtype: "timesheet",
    billfinalizedat: "2026-09-29T12:00:00.000+00:00", supersedesbillid: null, billfilename: `Bill${CASE} Inkwell 2026 09 10-0`,
    billpdfpath: KEY, billsentat: null, billsentto: null, billreports: null, billpaiddate: null, billestimate: false,
    billpriority: null, billcomments: null, billsecondnoticedate: null, billfinalnoticedate: null, ...bill,
  }],
  tblcase: [{ caseid: CASE, casetitle: "Invented v. Fixture", casecaption: "Court of Fixtures No. IDEM-1", caseatty: 81, billingalert: false, billingcc: "clerk@example.test" }],
  tblattorney: [{ attyid: 81, attyemail: "inkwell@example.test", attylastname: "Inkwell" }],
  tblbilllines: [{ billid: BID, lineno: 1, kind: "charge", linedate: "2026-09-01", description: "Review", personid: null, hours: null, rate: null, amount: "500.00" }],
  tblbillingnames: [], tblactivity: [],
});
const who = { auth: { getUser: async () => ({ data: { user: { id: "qa", email: "qa@example.test" } } }) },
  from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { role: "admin", personid: null } }) }) }) }) };
const cfg = { apiKey: "re_test_stub", apiUrl: stubUrl, from: "bills@example.test" };
// A short client timeout stands in for the code's 30s one (the hang mode is otherwise identical); the code's own signal must be there.
const shortFetch = (url, init) => { assert.ok(init.signal instanceof AbortSignal, "code passes a timeout signal"); return fetch(url, { ...init, signal: AbortSignal.timeout(400) }); };

/** A fresh render (as after a reload): default draft from the DB's current state, a NEW token, sentat as rendered. */
async function render(db, edit = {}) {
  const d = await loadSend(db, BID);
  const draft = billEmailDraft(d, "office@example.test");
  const f = new FormData();
  for (const [k, v] of Object.entries({ token: randomUUID(), sentat: d.bill.billsentat ?? "", to: draft.to, cc: draft.cc, bcc: "", subject: draft.subject, body: draft.body, ...edit })) f.set(k, v);
  return f;
}
async function act(db, f, now = "2026-09-30T14:00:00.000Z") {
  const seen = { url: null, state: null };
  try {
    seen.state = await runSend(BID, f, {
      session: () => requireSession("admin", who), db: () => db, now: () => new Date(now), config: () => ({ ...cfg, apiUrl: stubUrl }),
      readPdf: (k) => readStoredFile(storage, k), fetch: shortFetch, revalidatePath: () => {},
      redirect: (u) => { seen.url = u; throw Object.assign(new Error("NEXT_REDIRECT"), { digest: "NEXT_REDIRECT" }); },
    });
  } catch (e) { if (e.message !== "NEXT_REDIRECT") throw e; }
  return seen;
}
const sent = (db) => [db.tables.tblbills[0].billsentat, db.tables.tblbills[0].billsentto];

for (const lost of ["hang", "drop"]) {
  test(`IDEM-${lost}: accepted-then-${lost} → noanswer, not marked sent; reload retry reuses the key (one delivery); edited subject → new key; Send again → new key`, async () => {
    fresh();
    const db = seed();
    mode = lost;
    const r1 = await act(db, await render(db));
    assert.equal(r1.url, null);
    assert.equal(r1.state?.code, "noanswer", JSON.stringify(r1.state));
    assert.match(r1.state.message, /may have been sent/i);
    assert.match(r1.state.message, /not marked sent/i);
    assert.deepEqual(sent(db), [null, null], "bill NOT marked sent after a lost answer");
    assert.equal(hits.length, 1);
    const k1 = hits[0].key;
    assert.match(k1, new RegExp(`^bill-${BID}-none-[0-9a-f]{32}$`));
    assert.equal(delivered.size, 1, "the stub accepted (delivered) the first message");

    // Reload: a fresh render with a new token and the same default draft → SAME key; the stub dedupes, bill now marked sent.
    mode = "ok";
    const r2 = await act(db, await render(db), "2026-09-30T14:05:00.000Z");
    assert.equal(r2.url, `/bills/${BID}/send?sent=1`, JSON.stringify(r2.state));
    assert.equal(hits.length, 2);
    assert.equal(hits[1].key, k1, "unchanged retry after reload sends the same Idempotency-Key");
    assert.equal(delivered.size, 1, "one delivery across the lost answer + retry");
    assert.deepEqual(sent(db), ["2026-09-30T14:05:00.000Z", "inkwell@example.test"]);

    // Send again after success: same payload, new render → DIFFERENT key (scoped on the new billsentat) → a second delivery.
    const r3 = await act(db, await render(db), "2026-09-30T15:00:00.000Z");
    assert.equal(r3.url, `/bills/${BID}/send?sent=1`, JSON.stringify(r3.state));
    assert.equal(hits.length, 3);
    assert.notEqual(hits[2].key, k1, "Send again after a success gets a new key");
    assert.equal(hits[2].body.subject, hits[0].body.subject, "same payload, so only the scope changed the key");
    assert.equal(delivered.size, 2);
  });
}

test("IDEM-edit: after a lost answer, a retry with a changed subject sends a DIFFERENT key (a new message)", async () => {
  fresh();
  const db = seed();
  mode = "drop";
  assert.equal((await act(db, await render(db))).state?.code, "noanswer");
  mode = "ok";
  const r = await act(db, await render(db, { subject: "Re: Court of Fixtures No. IDEM-1 (corrected)" }));
  assert.equal(r.url, `/bills/${BID}/send?sent=1`, JSON.stringify(r.state));
  assert.equal(hits.length, 2);
  assert.notEqual(hits[1].key, hits[0].key);
  assert.equal(hits[1].key.split("-").slice(0, 3).join("-"), hits[0].key.split("-").slice(0, 3).join("-"), "same scope, payload hash differs");
  assert.equal(delivered.size, 2);
});

test("IDEM-again: a lost answer on Send again restores the previous send and a reload retry reuses that attempt's key", async () => {
  fresh();
  const prev = ["2026-09-15T09:00:00.000+00:00", "earlier@example.test"];
  const db = seed({ billsentat: prev[0], billsentto: prev[1] });
  mode = "hang";
  const r1 = await act(db, await render(db));
  assert.equal(r1.state?.code, "noanswer");
  assert.deepEqual(sent(db), prev, "previous send kept, not overwritten");
  mode = "ok";
  const r2 = await act(db, await render(db));
  assert.equal(r2.url, `/bills/${BID}/send?sent=1`, JSON.stringify(r2.state));
  assert.equal(hits[1].key, hits[0].key);
  assert.ok(hits[0].key.startsWith(`bill-${BID}-${prev[0]}-`));
  assert.equal(delivered.size, 1);
});
