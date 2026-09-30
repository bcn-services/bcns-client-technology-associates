// Item 6 notice resend (unit): stampNotice / noticeKey / saveNoticePdf (lib/bill-docs/notice.ts), canSendNotice
// (lib/bills/rules.ts), noticeEmailDraft + runSend(kind "notice") (lib/bills/send.ts), the bill page and /bills list
// links. In-memory PostgREST fake + a LOCAL Resend stub on a random port — the real API is never called.
// Every name, figure and address is invented (@example.test).
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { inflateSync } from "node:zlib";
import { createRequire } from "node:module";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { PDFDocument, PDFName, PDFDict } from "pdf-lib";

globalThis.React = React;
const rdom = createRequire(import.meta.url)("react-dom");
rdom.useFormStatus = () => ({ pending: false });
rdom.useFormState = (_a, init) => [init, () => {}];
const { runSend, loadSend, noticeEmailDraft, billEmailDraft } = await import("../../lib/bills/send.ts");
const { stampNotice, noticeKey, STAMP_BOX } = await import("../../lib/bill-docs/notice.ts");
const { STAMP_PNG } = await import("../../lib/bill-docs/stamps.ts");
const { renderInvoice } = await import("../../lib/bill-docs/invoice.ts");
const { canSendNotice, isNoticeStage } = await import("../../lib/bills/rules.ts");
const { requireSession } = await import("../../lib/auth/session.ts");
const { BillView } = await import("../../app/bills/[id]/bill-view.tsx");
const { BillsListView } = await import("../../app/bills/bills-list-view.tsx");
const { loadBill } = await import("../../lib/bills/edit.ts");

const PNG = { SecondNotice: readFileSync(new URL("../../lib/bill-docs/stamps/SecondNotice.png", import.meta.url)), FinalNotice: readFileSync(new URL("../../lib/bill-docs/stamps/FinalNotice.png", import.meta.url)) };

/** PostgREST-shaped fake (as send-qa.test.mjs): eq / is / in filters, update(...).select() → updated rows. */
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

let stub, stubUrl, hits = [], answer = () => [200, { id: "notice-stub" }];
before(async () => {
  stub = createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => { raw += c; });
    req.on("end", () => {
      hits.push({ headers: req.headers, body: JSON.parse(raw || "{}") });
      const [s, j] = answer();
      res.writeHead(s, { "content-type": "application/json" }).end(JSON.stringify(j));
    });
  });
  await new Promise((r) => stub.listen(0, "127.0.0.1", r));
  stubUrl = `http://127.0.0.1:${stub.address().port}`;
});
after(() => stub?.close());
const fresh = () => { hits = []; answer = () => [200, { id: "notice-stub" }]; };

// An invented invoice rendered by the real item-4 renderer (letter page, WinAnsi hex strings).
const CASE = 993661, BID = 6611, KEY = `bills/${CASE}/Bill${CASE} Inkwright 2026 07 01-0.pdf`;
const LINES = [
  { kind: "charge", linedate: "2026-06-03", description: "Reviewed invented exhibit binder", personid: null, hours: null, rate: null, amount: 60000 },
  { kind: "expense", linedate: "2026-06-09", description: "Courier to fixture court", personid: null, hours: null, rate: null, amount: 4250 },
];
const ORIGINAL = Buffer.from(await renderInvoice({
  bill: { billid: BID, billcaseid: CASE, billdate: "2026-07-01", billtype: "retainer", billhours: 0, billbalance: "642.50", billfinalizedat: "2026-07-01T10:00:00Z", billfilename: `Bill${CASE} Inkwright 2026 07 01-0`, billpdfpath: KEY },
  casetitle: "Sample v. Placeholder", casecaption: "Court of Fixtures No. N-6", address: ["Atty. Pat Inkwright", "1 Example Row", "Faketown ZZ 00001"], attyLastName: "Inkwright", lines: LINES,
}, { letterhead: ["Invented Consulting Co."], taxId: "00-0000000" }));

const WIN = { 0x91: "‘", 0x92: "’", 0x93: "“", 0x94: "”", 0x96: "–", 0x97: "—", 0x85: "…" };
/** Every `<..> Tj` string in the PDF's flate streams (as invoice.test.mjs). */
function pdfText(buf) {
  const out = [];
  const s = Buffer.from(buf).toString("latin1");
  for (const m of s.matchAll(/stream\r?\n/g)) {
    const start = m.index + m[0].length, end = s.indexOf("endstream", start);
    let body = Buffer.from(s.slice(start, end), "latin1");
    try { body = inflateSync(body); } catch { continue; }
    for (const t of body.toString("latin1").matchAll(/<([0-9A-Fa-f]*)> Tj/g)) out.push([...Buffer.from(t[1], "hex")].map((c) => WIN[c] ?? String.fromCharCode(c)).join(""));
  }
  return out;
}
/** Page 1's image XObjects ({name, width, height, bytes}) and its decoded content-stream text. */
async function page1(bytes) {
  const doc = await PDFDocument.load(bytes);
  const pg = doc.getPage(0);
  const images = [];
  const xo = pg.node.Resources()?.lookupMaybe(PDFName.of("XObject"), PDFDict);
  for (const [k, ref] of xo?.entries() ?? []) {
    const s = doc.context.lookup(ref);
    if (s.dict.get(PDFName.of("Subtype"))?.toString() !== "/Image") continue;
    images.push({ name: k.toString(), width: Number(s.dict.get(PDFName.of("Width")).toString()), height: Number(s.dict.get(PDFName.of("Height")).toString()), bytes: Buffer.from(s.contents) });
  }
  const c = pg.node.Contents();
  const ops = (c.asArray ? c.asArray() : [c]).map((r) => { const s = doc.context.lookup(r) ?? r; let b = Buffer.from(s.contents); try { b = inflateSync(b); } catch {} return b.toString("latin1"); }).join("");
  return { images, ops, height: pg.getHeight() };
}
/** The image stream pdf-lib makes for a PNG file on disk, in a fresh document — what the stamp must carry. */
async function referenceImage(png) {
  const d = await PDFDocument.create();
  d.addPage().drawImage(await d.embedPng(png), { x: 0, y: 0 });
  return (await page1(await d.save())).images[0];
}
const ihdr = (png) => [png.readUInt32BE(16), png.readUInt32BE(20)];

test("stamps.ts base64 is byte-identical to lib/bill-docs/stamps/*.png", () => {
  for (const n of ["SecondNotice", "FinalNotice"]) assert.ok(Buffer.from(STAMP_PNG[n], "base64").equals(PNG[n]), `${n} drifted — regenerate stamps.ts`);
});

for (const [notice, png, other] of [["2nd", "SecondNotice", "FinalNotice"], ["Final", "FinalNotice", "SecondNotice"]]) {
  test(`done-when: ${notice} notice page 1 draws the ${png}.png image at x=150, y=H-250-35, 120x35; every original line still extracts; original untouched; deterministic`, async () => {
    const before = Buffer.from(ORIGINAL);
    const out = Buffer.from(await stampNotice(ORIGINAL, notice));
    assert.ok(ORIGINAL.equals(before), "input bytes unchanged");
    const p = await page1(out);
    assert.equal(p.images.length, 1, "exactly one image on page 1");
    const [img] = p.images;
    const ref = await referenceImage(PNG[png]);
    assert.deepEqual([img.width, img.height], ihdr(PNG[png]), "image is the PNG's pixel size");
    assert.ok(img.bytes.equals(ref.bytes), `image bytes come from ${png}.png`);
    assert.ok(!img.bytes.equals((await referenceImage(PNG[other])).bytes), `not ${other}.png`);
    assert.deepEqual(STAMP_BOX, { left: 150, top: 250, width: 120, height: 35 });
    const y = p.height - 250 - 35;
    assert.equal(p.height, 792);
    const esc = img.name.replace(/[-/]/g, "\\$&");
    assert.match(p.ops, new RegExp(`q\\n1 0 0 1 150 ${y} cm\\n1 0 0 1 0 0 cm\\n120 0 0 35 0 0 cm\\n1 0 0 1 0 0 cm\\n${esc} Do\\nQ`), p.ops.slice(-200));
    const t0 = pdfText(ORIGINAL), t1 = pdfText(out);
    assert.ok(t0.length > 5);
    for (const s of t0) assert.ok(t1.includes(s), `original text lost: ${s}`);
    for (const l of LINES) assert.ok(t1.some((s) => s.includes(l.description)), l.description);
    assert.ok(out.equals(Buffer.from(await stampNotice(ORIGINAL, notice))), "same input → same bytes (retry keeps its idempotency key)");
  });
}

test("noticeKey: beside the original, never equal to it; unknown notice refused", () => {
  assert.equal(noticeKey(KEY, "2nd"), `bills/${CASE}/Bill${CASE} Inkwright 2026 07 01-0 SecondNotice.pdf`);
  assert.equal(noticeKey(KEY, "Final"), `bills/${CASE}/Bill${CASE} Inkwright 2026 07 01-0 FinalNotice.pdf`);
  assert.throws(() => noticeKey(KEY, "1st"));
  assert.throws(() => noticeKey(KEY, "toString"));
});

test("canSendNotice: 2nd/Final + typed + finalized + stored PDF; broken lines don't matter", () => {
  const ok = { billtype: "retainer", billfinalizedat: "2026-07-01T10:00:00Z", billpdfpath: KEY, billnotice: "2nd" };
  assert.equal(canSendNotice(ok), true);
  assert.equal(canSendNotice({ ...ok, billnotice: "Final" }), true);
  for (const n of ["1st", "Paid", "Partial Payment", "Deadbeat", "Cancelled", "toString", "hasOwnProperty"]) assert.equal(canSendNotice({ ...ok, billnotice: n }), false, n);
  assert.equal(canSendNotice({ ...ok, billpdfpath: null }), false);
  assert.equal(canSendNotice({ ...ok, billfinalizedat: null }), false);
  assert.equal(canSendNotice({ ...ok, billtype: null }), false);
  assert.deepEqual(["2nd", "Final", "1st"].map(isNoticeStage), [true, true, false]);
});

const row = (o = {}) => ({
  billid: BID, billcaseid: CASE, billdate: "2026-07-01", billhours: 0, billbalance: "642.50", billnotice: "2nd", billtype: "retainer",
  billfinalizedat: "2026-07-01T10:00:00.000+00:00", supersedesbillid: null, billfilename: `Bill${CASE} Inkwright 2026 07 01-0`,
  billpdfpath: KEY, billsentat: "2026-07-02T09:00:00.000+00:00", billsentto: "ink@example.test", billreports: null, billpaiddate: null, billestimate: false,
  billpriority: null, billcomments: null, billsecondnoticedate: "2026-08-05", billfinalnoticedate: null, ...o,
});
const seed = (o = {}) => memDb({
  tblbills: [row(o.bill), ...(o.more ?? [])],
  tblcase: [{ caseid: CASE, casetitle: "Sample v. Placeholder", casecaption: "Court of Fixtures No. N-6", caseatty: 66, billingalert: false, billingcc: "para@example.test" }],
  tblattorney: [{ attyid: 66, attyemail: "ink@example.test", attylastname: "Inkwright" }],
  tblbilllines: o.lines ?? LINES.map((l, i) => ({ billid: BID, lineno: i + 1, ...l, amount: (l.amount / 100).toFixed(2) })),
  tblbillingnames: [], tblactivity: [],
});
const who = (role) => ({
  auth: { getUser: async () => ({ data: { user: { id: "n-user", email: "n@example.test" } } }) },
  from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { role, personid: null } }) }) }) }),
});
const cfg = { apiKey: "re_test_stub", apiUrl: stubUrl, from: "bills@example.test" };
const fdFrom = (b, draft, o = {}) => {
  const f = new FormData();
  for (const [k, v] of Object.entries({ token: randomUUID(), sentat: b.billsentat ?? "", notice: b.billnotice, ...draft, ...o })) f.set(k, v);
  return f;
};
async function act(db, f, o = {}) {
  const seen = { url: null, reads: [], writes: [], dbCalls: 0, state: null };
  try {
    seen.state = await runSend(BID, f, {
      session: () => requireSession("admin", who(o.role ?? "admin")),
      db: () => { seen.dbCalls++; return db; },
      now: () => new Date("2026-09-30T15:00:00.000Z"),
      config: () => ({ ...cfg, apiUrl: stubUrl }),
      readPdf: async (k) => { seen.reads.push(k); return new Uint8Array(ORIGINAL); },
      writePdf: async (k, bytes) => { seen.writes.push([k, Buffer.from(bytes)]); },
      revalidatePath: () => {},
      redirect: (u) => { seen.url = u; throw Object.assign(new Error("NEXT_REDIRECT"), { digest: "NEXT_REDIRECT" }); },
    }, o.kind ?? "notice");
  } catch (e) { if (e.message !== "NEXT_REDIRECT") throw e; }
  return seen;
}
const NOTICE_COLS = (db) => { const b = db.tables.tblbills[0]; return [b.billnotice, b.billsecondnoticedate, b.billfinalnoticedate]; };

test("noticeEmailDraft: To attorney, CC billingcc, BCC NOTICE_BCC_EMAIL, Re: <caption>; Final adds the USPS line", async () => {
  const d2 = noticeEmailDraft(await loadSend(seed(), BID), "archive@example.test");
  assert.deepEqual([d2.to, d2.cc, d2.bcc, d2.subject], ["ink@example.test", "para@example.test", "archive@example.test", "Re: Court of Fixtures No. N-6"]);
  assert.equal(d2.body, "Dear Atty. Inkwright,\n\nAttached is a copy of an invoice that is past due in the subject matter.\n\nPlease contact us if there are any questions.\n\nThank you,");
  const dF = noticeEmailDraft(await loadSend(seed({ bill: { billnotice: "Final" } }), BID), "archive@example.test");
  assert.equal(dF.body, "Dear Atty. Inkwright,\n\nAttached is a copy of an invoice that is past due in the subject matter.\nA copy has also been mailed via USPS.\n\nPlease contact us if there are any questions.\n\nThank you,");
  assert.equal(noticeEmailDraft(await loadSend(seed(), BID), undefined).bcc, "");
});

for (const [notice, word, usps] of [["2nd", "SecondNotice", false], ["Final", "FinalNotice", true]]) {
  test(`done-when: ${notice} notice send carries the BCC and the ${notice} body; attachment = stamped stored PDF saved at the notice key; original never written; notice fields byte-identical`, async () => {
    fresh();
    const db = seed({ bill: { billnotice: notice, billfinalnoticedate: notice === "Final" ? "2026-09-04" : null } });
    const before = JSON.stringify(NOTICE_COLS(db));
    const b = db.tables.tblbills[0];
    const draft = noticeEmailDraft(await loadSend(db, BID), "archive@example.test");
    const r = await act(db, fdFrom(b, draft));
    assert.equal(r.url, `/bills/${BID}/notice?sent=1`, JSON.stringify(r.state));
    assert.equal(hits.length, 1);
    const h = hits[0].body;
    assert.deepEqual([h.to, h.cc, h.bcc, h.subject], [["ink@example.test"], ["para@example.test"], ["archive@example.test"], "Re: Court of Fixtures No. N-6"]);
    assert.equal(h.text.includes("A copy has also been mailed via USPS."), usps);
    assert.equal(h.attachments.length, 1);
    assert.equal(h.attachments[0].filename, `Bill${CASE} Inkwright 2026 07 01-0 ${word}.pdf`);
    const att = Buffer.from(h.attachments[0].content, "base64");
    assert.ok(att.equals(Buffer.from(await stampNotice(ORIGINAL, notice))), "attachment = stored original stamped");
    assert.deepEqual(r.reads, [KEY], "reads the STORED invoice");
    assert.deepEqual(r.writes.map((w) => w[0]), [noticeKey(KEY, notice)], "writes only the notice key");
    assert.ok(!r.writes.some((w) => w[0] === KEY), "original never overwritten");
    assert.ok(r.writes[0][1].equals(att), "saved notice == attachment");
    assert.equal(JSON.stringify(NOTICE_COLS(db)), before, "billnotice / notice dates untouched");
    for (const [, upd] of db.writes) for (const k of ["billnotice", "billsecondnoticedate", "billfinalnoticedate", "billpdfpath"]) assert.ok(!(k in upd), `wrote ${k}`);
    assert.deepEqual([db.tables.tblbills[0].billsentat, db.tables.tblbills[0].billsentto], ["2026-09-30T15:00:00.000Z", "ink@example.test"]);
    assert.match(hits[0].headers["idempotency-key"], new RegExp(`^notice-${word}-${BID}-2026-07-02T09:00:00\\.000\\+00:00-[0-9a-f]{32,64}$`));
  });
}

test("idempotency scope: invoice send vs 2nd notice vs Final notice differ, and never hold an address", async () => {
  fresh();
  const draft = { to: "ink@example.test", cc: "para@example.test", bcc: "", subject: "Re: X", body: "Same body" };
  const keys = [];
  for (const [notice, kind] of [["2nd", "bill"], ["2nd", "notice"], ["Final", "notice"]]) {
    const db = seed({ bill: { billnotice: notice } });
    const r = await act(db, fdFrom(db.tables.tblbills[0], draft), { kind });
    assert.ok(r.url, JSON.stringify(r.state));
    keys.push(hits.at(-1).headers["idempotency-key"]);
  }
  const scopes = keys.map((k) => k.replace(/-[0-9a-f]{32,64}$/, ""));
  assert.deepEqual(scopes, [`bill-${BID}-2026-07-02T09:00:00.000+00:00`, `notice-SecondNotice-${BID}-2026-07-02T09:00:00.000+00:00`, `notice-FinalNotice-${BID}-2026-07-02T09:00:00.000+00:00`]);
  for (const k of keys) assert.doesNotMatch(k, /@|example/);
});

test("staff: notice send refused as forbidden — no DB, no PDF read or write, no provider call", async () => {
  fresh();
  const db = seed();
  const r = await act(db, fdFrom(db.tables.tblbills[0], { to: "ink@example.test", cc: "", bcc: "", subject: "S", body: "B" }), { role: "staff" });
  assert.equal(r.state?.code, "forbidden");
  assert.deepEqual([r.dbCalls, r.reads.length, r.writes.length, hits.length, db.writes.length], [0, 0, 0, 0, 0]);
});

test("no stored PDF / legacy / not at 2nd-Final: refused with its reason before any read, write or provider call", async () => {
  fresh();
  for (const [o, code] of [[{ billpdfpath: null }, "notice-nopdf"], [{ billtype: null, billpdfpath: null, billfinalizedat: null }, "notice-legacy"], [{ billnotice: "1st" }, "notice-stage"], [{ billnotice: "Paid" }, "notice-stage"]]) {
    const db = seed({ bill: o });
    const r = await act(db, fdFrom(db.tables.tblbills[0], { to: "ink@example.test", cc: "", bcc: "", subject: "S", body: "B" }));
    assert.equal(r.state?.code, code, JSON.stringify(o));
    assert.deepEqual([r.reads.length, r.writes.length, db.writes.length], [0, 0, 0]);
  }
  assert.equal(hits.length, 0);
});

test("stale: notice advanced since the preview (form says 2nd, bill now Final) → refused, nothing sent", async () => {
  fresh();
  const db = seed({ bill: { billnotice: "Final" } });
  const r = await act(db, fdFrom(db.tables.tblbills[0], { to: "ink@example.test", cc: "", bcc: "", subject: "S", body: "B" }, { notice: "2nd" }));
  assert.equal(r.state?.code, "stale");
  assert.deepEqual([r.reads.length, r.writes.length, hits.length, db.writes.length], [0, 0, 0, 0]);
});

test("another bill's invoice already at the notice key → refused, no write, no provider call", async () => {
  fresh();
  const db = seed({ more: [row({ billid: BID + 1, billpdfpath: noticeKey(KEY, "2nd") })] });
  const r = await act(db, fdFrom(db.tables.tblbills[0], { to: "ink@example.test", cc: "", bcc: "", subject: "S", body: "B" }));
  assert.equal(r.state?.code, "notice-key");
  assert.deepEqual([r.writes.length, hits.length, db.writes.length], [0, 0, 0]);
});

test("notice send: Resend 409 → noanswer, released (last-emailed unchanged), detail kept", async () => {
  fresh();
  answer = () => [409, { statusCode: 409, name: "concurrent_idempotent_requests", message: "in flight" }];
  const db = seed();
  const b = { ...db.tables.tblbills[0] };
  const r = await act(db, fdFrom(b, { to: "ink@example.test", cc: "", bcc: "", subject: "S", body: "B" }));
  assert.equal(r.state?.code, "noanswer");
  assert.match(r.state.message, /409 in flight/);
  assert.deepEqual([db.tables.tblbills[0].billsentat, db.tables.tblbills[0].billsentto], [b.billsentat, b.billsentto]);
});

test("bill page: admin at 2nd/Final with a stored PDF gets 'Send <notice> notice'; without one, the reason; staff and 1st get neither", async () => {
  const html = async (o, admin) => renderToStaticMarkup(React.createElement(BillView, { data: await loadBill(seed({ bill: o }), BID), admin }));
  const a = await html({}, true);
  assert.match(a, /<a data-testid="bill-send-notice"[^>]*href="\/bills\/6611\/notice">Send 2nd notice<\/a>/);
  assert.match(await html({ billnotice: "Final" }, true), />Send Final notice</);
  const nopdf = await html({ billpdfpath: null }, true);
  assert.doesNotMatch(nopdf, /bill-send-notice/);
  assert.match(nopdf, /data-testid="bill-notice-blocked"[^>]*>This bill has no stored invoice PDF/);
  assert.match(await html({ billtype: null, billpdfpath: null, billfinalizedat: null }, true), /data-testid="bill-notice-blocked"[^>]*>This is a legacy bill with no stored invoice PDF/);
  assert.doesNotMatch(await html({}, false), /bill-send-notice|bill-notice-blocked/);
  assert.doesNotMatch(await html({ billnotice: "1st" }, true), /bill-send-notice|bill-notice-blocked/);
});

test("/bills list: admin rows link to Send notice or say 'No stored PDF'; staff see neither", () => {
  const r = (o) => ({ billid: 1, caseNumber: CASE, filename: "f", billdate: "2026-07-01", balance: 1, lastNotice: "2026-08-05", days: 40, due: true, sendNotice: false, noticeWhy: null, ...o });
  const groups = [{ stage: "2nd", rows: [r({ billid: 11, sendNotice: true }), r({ billid: 12, noticeWhy: "notice-nopdf" })] }, { stage: "1st", rows: [r({ billid: 13 })] }];
  const admin = renderToStaticMarkup(React.createElement(BillsListView, { groups, admin: true }));
  assert.match(admin, /<a[^>]*href="\/bills\/11\/notice"[^>]*>Send notice<\/a>|<a[^>]*data-testid="send-notice"[^>]*href="\/bills\/11\/notice"/);
  assert.equal((admin.match(/data-testid="send-notice"/g) ?? []).length, 1);
  assert.match(admin, /data-testid="notice-blocked" title="This bill has no stored invoice PDF[^"]*"[^>]*>No stored PDF</);
  assert.doesNotMatch(admin, /\/bills\/13\/notice/);
  assert.doesNotMatch(renderToStaticMarkup(React.createElement(BillsListView, { groups })), /send-notice|notice-blocked/);
});

test("billEmailDraft unchanged by item 6 (invoice send still has no BCC)", async () => {
  assert.equal(billEmailDraft(await loadSend(seed(), BID), "office@example.test").bcc, "");
});
