// Item 4: invoice PDF (lib/bill-docs/invoice.ts) from a finalized bill's STORED lines, over the same stateful fake
// PostgREST as finalize.test.mjs and an in-memory storage adapter. Text is pulled out of the PDF with node:zlib only.
// Synthetic fixtures; every name/figure below is invented.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { inflateSync } from "node:zlib";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

globalThis.React = React;
createRequire(import.meta.url)("react-dom").useFormStatus = () => ({ pending: false });
const { runFinalize, loadFinalize } = await import("../../lib/bills/finalize.ts");
const { requireSession } = await import("../../lib/auth/session.ts");
const inv = await import("../../lib/bill-docs/invoice.ts");
const { billFileName } = await import("../../lib/bills/rules.ts");
const { BillView } = await import("../../app/bills/[id]/bill-view.tsx");
const { loadBill } = await import("../../lib/bills/edit.ts");

function fakeDb(tables) {
  let nextId = 5000;
  return {
    tables,
    from(table) {
      const q = { filters: [], orders: [], update: null, insert: null, del: false, single: false, range: null };
      const b = new Proxy({}, {
        get(_, k) {
          if (k === "then") {
            const all = (tables[table] ??= []);
            let rows;
            if (q.insert) { rows = [q.insert].flat().map((r) => ({ lineid: nextId++, ...r })); all.push(...rows); }
            else {
              rows = all.filter((r) => q.filters.every((f) => f(r)));
              if (q.update) for (const r of rows) Object.assign(r, q.update);
              if (q.del) tables[table] = all.filter((r) => !rows.includes(r));
              for (const [col, asc] of [...q.orders].reverse()) rows = [...rows].sort((x, y) => (x[col] < y[col] ? -1 : x[col] > y[col] ? 1 : 0) * (asc ? 1 : -1));
              if (q.range) rows = rows.slice(q.range[0], q.range[1] + 1);
            }
            const data = q.single ? (rows[0] ? { ...rows[0] } : null) : rows.map((r) => ({ ...r }));
            return (res, rej) => Promise.resolve({ data, error: null }).then(res, rej);
          }
          return (...a) => {
            if (k === "eq") q.filters.push((r) => r[a[0]] === a[1]);
            if (k === "is" || (k === "filter" && a[1] === "is")) q.filters.push((r) => (r[a[0]] ?? null) === (k === "is" ? a[1] : null));
            if (k === "in") q.filters.push((r) => a[1].includes(r[a[0]]));
            if (k === "order") q.orders.push([a[0], a[1]?.ascending !== false]);
            if (k === "range") q.range = a;
            if (k === "update") q.update = a[0];
            if (k === "insert") q.insert = a[0];
            if (k === "delete") q.del = true;
            if (k === "maybeSingle" || k === "single") q.single = true;
            return b;
          };
        },
      });
      return b;
    },
  };
}
const fakeStorage = () => {
  const files = new Map();
  return { files, putFile: async (key, body, type) => { files.set(key, { body: Buffer.from(body), type }); }, getSignedUrl: async (k) => `http://x/${k}`, listKeys: async () => [...files.keys()] };
};

const CASE = 992310, B = 810;
const bill = (o = {}) => ({
  billid: B, billcaseid: CASE, billdate: "2026-09-07", billhours: 0, billbalance: 0, billnotice: "1st", billtype: "timesheet",
  billfinalizedat: null, supersedesbillid: null, billreports: null, billfilename: null, billpaiddate: null, billestimate: false,
  billpriority: null, billcomments: null, billsecondnoticedate: null, billfinalnoticedate: null, billpdfpath: null, ...o,
});
const act = (actid, actdate, acthrs, actwho, actdescription) => ({ actid, actcaseid: CASE, actdate, actdescription, acthrs, actwho, actbilled: true, actbillid: B });
const ATTY = { attyid: 41, attyfirmid: 51, attytitle: "Ms.", attyfirstname: "Rowan", attymiddlename: "Q", attylastname: "Testwood", attysuffix: null, attyesq: true };
const FIRM = { frmid: 51, frmname: "Placeholder & Sample LLP", frmaddress1: "100 Example Way", frmaddress2: "Suite 9", frmcity: "Faketown", frmstate: "ZZ", frmzip: "00001" };
const world = (o = {}) => fakeDb({
  tblbills: o.bills ?? [bill(o.bill)],
  tblcase: [{ caseid: CASE, casetitle: "Invented v. Fixture", casecaption: o.caption === undefined ? "Superior Court of Nowhere No. X-1" : o.caption, caseatty: 41, casestartdate: "2026-01-10", billingalert: true, billingcc: null }],
  tblattorney: [{ ...ATTY, ...o.atty }],
  tblfirm: [{ ...FIRM, ...o.firm }],
  tblactivity: o.activity ?? [
    act(21, "2026-08-10", "2.000", 1, "Reviewed invented deposition"),
    act(22, "2026-08-11", "1.500", 2, "Drafted sample memo"),
    act(23, "2026-08-12", "0.250", 1, "Call with fixture counsel"),
  ],
  tblbillingnames: [{ personid: 1, initials: "AAA", billingfactor: "1.000" }, { personid: 2, initials: "BBB", billingfactor: "0.750" }],
  tblfundsrcvd: o.funds ?? [{ fndsid: 7, fndscaseid: CASE, fndsdate: "2026-08-02", fndstype: "Check", fndspmt: "150.40", fndsbillid: null }],
  tblbilllines: o.lines ?? [],
});
const sessionClient = (role) => ({
  auth: { getUser: async () => ({ data: { user: { id: "u1", email: "q@example.test" } } }) },
  from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { role, personid: null } }) }) }) }),
});
const redirecting = (urls) => (u) => { urls.push(u); throw new Error("NEXT_REDIRECT"); };
async function finalize(db, { afterFinalize, id = B } = {}) {
  const d = await loadFinalize(db, id);
  const f = new FormData();
  f.set("fingerprint", d.fingerprint);
  f.set("rate.1", "399.00"); f.set("rate.2", "326.25");
  const urls = [];
  await assert.rejects(runFinalize(id, f, {
    session: () => requireSession("admin", sessionClient("admin")), db: () => db, now: () => new Date("2026-09-28T16:00:00Z"),
    revalidatePath: () => {}, redirect: redirecting(urls), afterFinalize,
  }), /NEXT_REDIRECT/);
  return urls[0];
}
const getB = (db, id = B) => db.tables.tblbills.find((b) => b.billid === id);
const stored = (db, id = B) => db.tables.tblbilllines.filter((l) => l.billid === id).sort((a, b) => a.lineno - b.lineno);

// WinAnsi 0x80–0x9F differs from Latin-1 (Node's TextDecoder("windows-1252") decodes it as Latin-1 here).
const WIN = { 0x91: "‘", 0x92: "’", 0x93: "“", 0x94: "”", 0x96: "–", 0x97: "—", 0x85: "…" };
/** Every `(..) Tj` / `<..> Tj` string in the PDF's (flate) content streams, decoded as WinAnsi (≈ cp1252). */
function pdfText(buf) {
  const out = [];
  const s = buf.toString("latin1");
  for (const m of s.matchAll(/stream\r?\n/g)) {
    const start = m.index + m[0].length, end = s.indexOf("endstream", start);
    let body = Buffer.from(s.slice(start, end), "latin1");
    try { body = inflateSync(body); } catch { continue; }
    for (const t of body.toString("latin1").matchAll(/<([0-9A-Fa-f]*)> Tj/g)) out.push([...Buffer.from(t[1], "hex")].map((c) => WIN[c] ?? String.fromCharCode(c)).join(""));
  }
  return out;
}
const CFG = { letterhead: ["Sample Consulting Co.", "1 Nowhere Plaza, Faketown ZZ 00001"], taxId: "00-0000000" };

test("done-when: a timesheet bill's PDF holds every stored line, the total lines and 'Balance due' with the stored amount; stored at billpdfpath as application/pdf", async () => {
  const db = world();
  const storage = fakeStorage();
  assert.equal(await finalize(db, { afterFinalize: (d, id) => inv.saveInvoicePdf(d, storage, id, CFG) }), `/bills/${B}?saved=1`);
  const b = getB(db);
  assert.equal(b.billfilename, "Bill992310 Testwood 2026 09 07-0");
  assert.equal(b.billpdfpath, `bills/${CASE}/Bill992310 Testwood 2026 09 07-0.pdf`);
  const file = storage.files.get(b.billpdfpath);
  assert.equal(file.type, "application/pdf");
  assert.equal(file.body.subarray(0, 5).toString(), "%PDF-");
  const t = pdfText(file.body);
  const joined = t.join("\n");
  for (const l of stored(db)) assert.ok(joined.includes(l.description), `line missing: ${l.description}`);
  // timesheet detail rows: M/D/YY + 2-decimal hours; totals print stored amount as #,###; credit rounds to whole dollars
  for (const s of ["8/10/26", "2.00 hrs", "8/11/26", "1.50 hrs", "8/12/26", "0.25 hrs", "2.25 hrs x $399/hr", "898", "1.5 hrs x $326.25/hr", "489", "8/2/26", "150"]) {
    assert.ok(t.includes(s), `missing cell ${s} in ${JSON.stringify(t)}`);
  }
  assert.equal(b.billbalance, "1236.60");
  const i = t.indexOf("Balance due:");
  assert.ok(i >= 0 && t[i + 1] === "$1,236.60", `balance due: ${t.slice(i, i + 2)}`);
  for (const s of ["INVOICE", "TAX ID: 00-0000000", "Sample Consulting Co.", "Rowan Q Testwood, Esq.", "Placeholder & Sample LLP", "Suite 9", "Faketown, ZZ 00001",
    "DATE: September 07, 2026", "RE: Invented v. Fixture", "Superior Court of Nowhere No. X-1", `Our File No.: ${CASE}`, "THANK YOU",
    "PLEASE RETURN A COPY OF THIS INVOICE WITH YOUR CHECK"]) assert.ok(t.includes(s), `missing ${s}`);
  assert.ok(!/alert|null|undefined|NaN/i.test(joined), "alert/null text on the PDF");
  assert.ok(!t.includes("Note:"), "estimate note on a non-estimate bill");
});

test("prints the STORED figures: a stored line/balance the pricing engine would never produce is printed as stored", async () => {
  // Stored amounts deliberately disagree with hours x rate and with the default rates; the PDF must not recompute.
  const lines = [
    { billid: B, lineno: 1, kind: "charge", linedate: "2026-08-10", description: "Invented work", personid: 1, hours: "3.000", rate: null, amount: "0.00" },
    { billid: B, lineno: 2, kind: "charge", linedate: null, description: "3 hrs x $123/hr", personid: 1, hours: "3.000", rate: "123.00", amount: "777.00" },
  ];
  const db = world({ bill: { billfinalizedat: "2026-09-28T16:00:00Z", billhours: "3.00", billbalance: "777.00" }, lines });
  const storage = fakeStorage();
  const key = await inv.saveInvoicePdf(db, storage, B, {});
  const t = pdfText(storage.files.get(key).body);
  assert.ok(t.includes("3 hrs x $123/hr") && t.includes("777") && t.includes("$777"), JSON.stringify(t));
  assert.ok(!t.includes("369") && !t.includes("1,305"), "re-priced");
});

test("refuses an unfinalized, a broken (lines lost) and a legacy bill — nothing stored, no path set", async () => {
  const good = [{ billid: B, lineno: 1, kind: "charge", linedate: "2026-08-01", description: "Flat fee", personid: null, hours: null, rate: null, amount: "500.00" }];
  for (const [o, lines, code] of [
    [{}, good, "unfinalized"],
    [{ billfinalizedat: "2026-09-28T16:00:00Z", billbalance: "500.00" }, [], "broken"],
    [{ billfinalizedat: "2026-09-28T16:00:00Z", billbalance: "500.00", billtype: null }, good, "legacy"],
  ]) {
    const db = world({ bill: o, lines });
    const storage = fakeStorage();
    await assert.rejects(inv.saveInvoicePdf(db, storage, B, {}), (e) => e instanceof inv.InvoiceError && e.code === code, code);
    assert.equal(storage.files.size, 0);
    assert.equal(getB(db).billpdfpath, null);
  }
  await assert.rejects(inv.saveInvoicePdf(world(), null, B, {}), (e) => e.code === "storage");
});

test("missing optional fields collapse: no middle name/address2/caption/letterhead/TAX ID → no blank labels, no 'null'", async () => {
  const lines = [{ billid: B, lineno: 1, kind: "charge", linedate: "2026-08-01", description: "Flat fee", personid: null, hours: null, rate: null, amount: "500.00" }];
  const db = world({ bill: { billfinalizedat: "2026-09-28T16:00:00Z", billbalance: "500.00" }, lines, caption: null,
    atty: { attymiddlename: null, attytitle: null }, firm: { frmaddress2: null } });
  const storage = fakeStorage();
  const t = pdfText(storage.files.get(await inv.saveInvoicePdf(db, storage, B, {})).body);
  assert.ok(t.includes("Rowan Testwood, Esq."), JSON.stringify(t));
  assert.ok(t.includes("08/01/26") && t.includes("500"), "flat row mm/dd/yy + #,###");
  assert.ok(!t.some((s) => /^TAX ID|null|undefined|Suite|Sample Consulting/.test(s) || /:\s*$/.test(s) && s !== "Balance due:"), JSON.stringify(t));
  assert.ok(!t.includes("Superior Court of Nowhere No. X-1"));
});

test("curly apostrophe and other non-ASCII text survive (WinAnsi), unencodable glyphs degrade to '?' instead of throwing", async () => {
  const lines = [{ billid: B, lineno: 1, kind: "charge", linedate: "2026-08-01", description: "Café review — “draft” Ω 中", personid: null, hours: null, rate: null, amount: "500.00" }];
  const db = world({ bill: { billfinalizedat: "2026-09-28T16:00:00Z", billbalance: "500.00" }, lines, atty: { attylastname: "O’Testwood" } });
  const storage = fakeStorage();
  const t = pdfText(storage.files.get(await inv.saveInvoicePdf(db, storage, B, {})).body).join("\n");
  assert.match(t, /Rowan Q O’Testwood, Esq\./);
  assert.match(t, /Café review — “draft” \? \?/);
  // Legacy strips only the ASCII apostrophe, so the stored name keeps ’; the storage key is ASCII-only.
  assert.equal(getB(db).billfilename, "Bill992310 O’Testwood 2026 09 07-0");
  assert.equal(getB(db).billpdfpath, `bills/${CASE}/Bill992310 OTestwood 2026 09 07-0.pdf`);
});

test("estimate bill: TBD rows with '(est.)', estimated balance and the 7-day note", async () => {
  const lines = [
    { billid: B, lineno: 1, kind: "estimate", linedate: null, description: "Trial testimony", personid: 1, hours: "8.000", rate: null, amount: "0.00" },
    { billid: B, lineno: 2, kind: "estimate", linedate: null, description: "8 hrs (est.) x $435/hr", personid: 1, hours: "8.000", rate: "435.00", amount: "3480.00" },
    { billid: B, lineno: 3, kind: "expense", linedate: null, description: "Trial expense", personid: null, hours: null, rate: null, amount: "100.00" },
  ];
  const db = world({ bill: { billtype: "estimate", billfinalizedat: "2026-09-28T16:00:00Z", billhours: "8.00", billbalance: "3580.00" }, lines });
  const storage = fakeStorage();
  const t = pdfText(storage.files.get(await inv.saveInvoicePdf(db, storage, B, {})).body);
  for (const s of ["TBD", "8 hrs (est.)", "3,480(est.)", "$100 (est.)", "$3,580(est.)", "Note:", "will be issued after completion of testimony."]) assert.ok(t.includes(s), `missing ${s}: ${JSON.stringify(t)}`);
});

test("legacy file-name suffix: two bills for the same case, attorney and date get -0 and -1 (CONFLICT: lane done-when says -1 and -2); a stored name is reused", async () => {
  const lines = (id) => [{ billid: id, lineno: 1, kind: "charge", linedate: "2026-08-01", description: "Flat fee", personid: null, hours: null, rate: null, amount: "500.00" }];
  const fin = { billfinalizedat: "2026-09-28T16:00:00Z", billbalance: "500.00" };
  const db = world({ bills: [bill({ ...fin }), bill({ ...fin, billid: B + 1 })], lines: [...lines(B), ...lines(B + 1)] });
  const storage = fakeStorage();
  const k1 = await inv.saveInvoicePdf(db, storage, B, {});
  const k2 = await inv.saveInvoicePdf(db, storage, B + 1, {});
  assert.equal(getB(db).billfilename, "Bill992310 Testwood 2026 09 07-0");
  assert.equal(getB(db, B + 1).billfilename, "Bill992310 Testwood 2026 09 07-1");
  assert.notEqual(k1, k2);
  assert.equal(await inv.saveInvoicePdf(db, storage, B + 1, {}), k2, "regenerate overwrites the same key");
  assert.equal(storage.files.size, 2);
  getB(db).billfilename = "Kept name";
  assert.equal(await inv.saveInvoicePdf(db, storage, B, {}), `bills/${CASE}/Kept name.pdf`);
});

test("D1: a bill whose stored name/key another bill already owns moves to the first free -N; each bill re-creates only its own key", async () => {
  const lines = (id) => [{ billid: id, lineno: 1, kind: "charge", linedate: "2026-08-01", description: "Flat fee", personid: null, hours: null, rate: null, amount: "500.00" }];
  const fin = { billfinalizedat: "2026-09-28T16:00:00Z", billbalance: "500.00" };
  const name0 = "Bill992310 Testwood 2026 09 07-0";
  const db = world({ bills: [bill({ ...fin }), bill({ ...fin, billid: B + 1 }), bill({ ...fin, billid: B + 2, billfilename: "Bill992310 Testwood 2026 09 07-2" })], lines: [...lines(B), ...lines(B + 1), ...lines(B + 2)] });
  const storage = fakeStorage();
  const k0 = await inv.saveInvoicePdf(db, storage, B, {});
  const first = Buffer.from(storage.files.get(k0).body);
  getB(db, B + 1).billfilename = name0; // admin typed bill 1's name into Edit bill → File name
  const k1 = await inv.saveInvoicePdf(db, storage, B + 1, {});
  assert.notEqual(k1, k0, "bill 2 overwrote bill 1's PDF");
  assert.equal(getB(db, B + 1).billfilename, "Bill992310 Testwood 2026 09 07-1", "first free -N, skipping names other bills use");
  assert.equal(getB(db, B + 1).billpdfpath, k1);
  assert.deepEqual(storage.files.get(k0).body, first, "bill 1's stored object untouched");
  assert.equal(await inv.saveInvoicePdf(db, storage, B, {}), k0, "bill 1 re-creates its own key");
  assert.equal(await inv.saveInvoicePdf(db, storage, B + 1, {}), k1, "bill 2 re-creates its own key");
  // A name owned by a bill with no PDF yet (bill 3, "-2") is still taken.
  getB(db, B + 1).billfilename = "Bill992310 Testwood 2026 09 07-2";
  assert.equal(await inv.saveInvoicePdf(db, storage, B + 1, {}), k1);
  assert.equal(getB(db, B + 1).billfilename, "Bill992310 Testwood 2026 09 07-1");
  // Different names, same storage key (invoiceKey drops "'"): still a collision.
  getB(db, B + 2).billfilename = "Bill992310 O'Neil 2026 09 07-0";
  getB(db).billfilename = "Bill992310 ONeil 2026 09 07-0";
  const kA = await inv.saveInvoicePdf(db, storage, B, {}), kB = await inv.saveInvoicePdf(db, storage, B + 2, {});
  assert.notEqual(kA, kB);
});

test("D1 re-date: a bill re-dated after creation does not free its -N for a new bill on the old date", async () => {
  const { fileNameFor } = await import("../../lib/bills/create.ts");
  const db = world({ bills: [bill({ billfilename: await fileNameFor(world({ bills: [] }), CASE, "Testwood", "2026-09-07") })] });
  assert.equal(getB(db).billfilename, "Bill992310 Testwood 2026 09 07-0");
  getB(db).billdate = "2026-09-08";
  assert.equal(await fileNameFor(db, CASE, "Testwood", "2026-09-07"), "Bill992310 Testwood 2026 09 07-1");
  assert.equal(await fileNameFor(db, CASE, "Testwood", "2026-09-09"), "Bill992310 Testwood 2026 09 09-0");
});

test("billFileName strips like the VBA across the whole name: '-' and '_' → space, '/' removed (\"'\" kept — tests/billing guard h)", () => {
  assert.equal(billFileName(7, "O'Neil-Smith_Jr/II", "2026-09-01", 0), "Bill7 O'Neil Smith JrII 2026 09 01-0");
  assert.equal(inv.invoiceKey(7, "Bill7 O'Neil Smith JrII 2026 09 01-0"), "bills/7/Bill7 ONeil Smith JrII 2026 09 01-0.pdf");
  assert.equal(billFileName(7, "Plain", "2026-09-01T00:00:00", 3), "Bill7 Plain 2026 09 01-3");
});

test("a PDF/storage failure after Finalize never un-finalizes the bill", async () => {
  for (const afterFinalize of [async () => { throw new Error("storage down"); }, (d, id) => inv.saveInvoicePdf(d, null, id, {})]) {
    const db = world();
    const orig = console.error; console.error = () => {};
    try { assert.equal(await finalize(db, { afterFinalize }), `/bills/${B}?saved=1`); } finally { console.error = orig; }
    assert.ok(getB(db).billfinalizedat);
    assert.ok(stored(db).length > 0);
    assert.equal(getB(db).billpdfpath, null);
  }
});

test("Create PDF action: admin → saved and path set; staff → forbidden, nothing stored; unfinalized → pdf-unfinalized", async () => {
  const run = async (db, storage, role) => {
    const urls = [];
    await assert.rejects(inv.runCreatePdf(B, {
      session: () => requireSession("admin", sessionClient(role)), db: () => db, storage: () => storage, config: () => ({}),
      revalidatePath: () => {}, redirect: redirecting(urls),
    }), /NEXT_REDIRECT/);
    return urls[0];
  };
  const lines = [{ billid: B, lineno: 1, kind: "charge", linedate: "2026-08-01", description: "Flat fee", personid: null, hours: null, rate: null, amount: "500.00" }];
  const fin = { billfinalizedat: "2026-09-28T16:00:00Z", billbalance: "500.00" };
  let db = world({ bill: fin, lines }), storage = fakeStorage();
  assert.equal(await run(db, storage, "staff"), `/bills/${B}?error=forbidden`);
  assert.equal(storage.files.size, 0);
  assert.equal(await run(db, storage, "admin"), `/bills/${B}?saved=1`);
  assert.equal(storage.files.size, 1);
  assert.ok(getB(db).billpdfpath);
  db = world({ lines });
  assert.equal(await run(db, fakeStorage(), "admin"), `/bills/${B}?error=pdf-unfinalized`);
});

test("bill page: download link when a PDF exists, Create PDF for admins when not, a note for staff; nothing before finalize", async () => {
  const lines = [{ billid: B, lineno: 1, kind: "charge", linedate: "2026-08-01", description: "Flat fee", personid: null, hours: null, rate: null, amount: "500.00" }];
  const html = async (o, admin) => {
    const data = await loadBill(world({ bill: o, lines }), B);
    return renderToStaticMarkup(React.createElement(BillView, { data, admin, createPdf: admin ? () => {} : undefined }));
  };
  const fin = { billfinalizedat: "2026-09-28T16:00:00Z", billbalance: "500.00" };
  assert.match(await html({ ...fin, billpdfpath: "bills/x/y.pdf" }, false), new RegExp(`href="/bills/${B}/pdf"[^>]*data-testid="bill-pdf"`));
  assert.match(await html(fin, true), /data-testid="bill-create-pdf"[\s\S]*Create PDF/);
  const staff = await html(fin, false);
  assert.match(staff, /data-testid="bill-no-pdf"/);
  assert.doesNotMatch(staff, /Create PDF/);
  const open = await html({}, true);
  assert.doesNotMatch(open, /bill-pdf|bill-create-pdf|bill-no-pdf/);
});
