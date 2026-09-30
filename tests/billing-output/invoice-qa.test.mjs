// QA gate for item 4 (invoice PDF), independent of the engineer's invoice.test.mjs: all 6 bill types priced by the
// item-2 engine, stored as tblbilllines, rendered by saveInvoicePdf; optional-field collapse incl. no attorney/firm;
// a 45-line bill that must span pages; file-name suffixes through the real create-time namer (fileNameFor).
// Every name and figure below is invented. Text is pulled from the PDF with node:zlib; page count from the page tree.
import { test } from "node:test";
import assert from "node:assert/strict";
import { inflateSync } from "node:zlib";

const inv = await import("../../lib/bill-docs/invoice.ts");
const { priceBill } = await import("../../lib/bills/lines.ts");
const { fileNameFor } = await import("../../lib/bills/create.ts");

const CASE = 992350, DATE = "2026-09-07";

/** Minimal stateful PostgREST fake: select/eq/order/range/maybeSingle/single/update. */
function fakeDb(tables) {
  return {
    tables,
    from(table) {
      const q = { f: [], o: [], upd: null, one: false, range: null };
      const b = new Proxy({}, {
        get(_, k) {
          if (k === "then") {
            let rows = (tables[table] ??= []).filter((r) => q.f.every((fn) => fn(r)));
            if (q.upd) for (const r of rows) Object.assign(r, q.upd);
            for (const [c, asc] of [...q.o].reverse()) rows = [...rows].sort((x, y) => (x[c] < y[c] ? -1 : x[c] > y[c] ? 1 : 0) * (asc ? 1 : -1));
            if (q.range) rows = rows.slice(q.range[0], q.range[1] + 1);
            const data = q.one ? (rows[0] ? { ...rows[0] } : null) : rows.map((r) => ({ ...r }));
            return (res, rej) => Promise.resolve({ data, error: null }).then(res, rej);
          }
          return (...a) => {
            if (k === "eq") q.f.push((r) => r[a[0]] === a[1]);
            if (k === "order") q.o.push([a[0], a[1]?.ascending !== false]);
            if (k === "range") q.range = a;
            if (k === "update") q.upd = a[0];
            if (k === "maybeSingle" || k === "single") q.one = true;
            return b;
          };
        },
      });
      return b;
    },
  };
}
const memStorage = () => { const files = new Map(); return { files, putFile: async (k, body, type) => { files.set(k, { body: Buffer.from(body), type }); } }; };

const WIN = { 0x91: "‘", 0x92: "’", 0x93: "“", 0x94: "”", 0x96: "–", 0x97: "—" };
function pdfText(buf) {
  const out = [], s = buf.toString("latin1");
  for (const m of s.matchAll(/stream\r?\n/g)) {
    const start = m.index + m[0].length;
    let body;
    try { body = inflateSync(Buffer.from(s.slice(start, s.indexOf("endstream", start)), "latin1")); } catch { continue; }
    for (const t of body.toString("latin1").matchAll(/<([0-9A-Fa-f]*)> Tj/g)) out.push([...Buffer.from(t[1], "hex")].map((c) => WIN[c] ?? String.fromCharCode(c)).join(""));
  }
  return out;
}
/** Page count from the page tree, which pdf-lib may put inside a compressed object stream. */
function pageCount(buf) {
  const s = buf.toString("latin1"), texts = [s];
  for (const m of s.matchAll(/stream\r?\n/g)) { const a = m.index + m[0].length; try { texts.push(inflateSync(Buffer.from(s.slice(a, s.indexOf("endstream", a)), "latin1")).toString("latin1")); } catch { /* not a flate stream */ } }
  for (const x of texts) { const m = x.match(/\/Type \/Pages[^>]*?\/Count (\d+)/) ?? x.match(/\/Count (\d+)[^>]*?\/Type \/Pages/); if (m) return Number(m[1]); }
  throw new Error("no page tree");
}

const ATTY = { attyid: 61, attyfirmid: 71, attytitle: "Mr.", attyfirstname: "Quill", attymiddlename: "J", attylastname: "Examplar", attysuffix: null, attyesq: true };
const FIRM = { frmid: 71, frmname: "Mockery & Stub LLP", frmaddress1: "9 Invented Rd", frmaddress2: "Floor 2", frmcity: "Nulltown", frmstate: "QQ", frmzip: "00002" };
const cents = (c) => (c / 100).toFixed(2);
const th = (t) => (t / 1000).toFixed(3);
const rowsOf = (billid, lines) => lines.map((l, i) => ({
  billid, lineno: i + 1, kind: l.kind, linedate: l.linedate, description: l.description, personid: l.personid,
  hours: l.hours === null ? null : th(l.hours), rate: l.rate === null ? null : cents(l.rate), amount: cents(l.amount),
}));
function world({ billtype, priced, billid = 900, atty = {}, firm = {}, caption = "Invented Superior Court", noAtty = false, filename = null }) {
  return fakeDb({
    tblbills: [{ billid, billcaseid: CASE, billdate: DATE, billtype, billhours: (Math.floor((priced.hours + 5) / 10) / 100).toFixed(2),
      billbalance: cents(priced.balance), billfinalizedat: "2026-09-28T16:00:00Z", billfilename: filename, billpdfpath: null }],
    tblcase: [{ caseid: CASE, casetitle: "Sample Matter v. Placeholder", casecaption: caption, caseatty: noAtty ? 999 : 61 }],
    tblattorney: noAtty ? [] : [{ ...ATTY, ...atty }],
    tblfirm: [{ ...FIRM, ...firm }],
    tblbilllines: rowsOf(billid, priced.lines),
  });
}
const price = (billType, extra = {}) => priceBill({ billType, billDate: DATE, caseStartDate: "2026-01-02", activity: [], factors: { 1: 1000, 2: 800 }, funds: [], ...extra });
const CFG = { letterhead: ["Invented Engineering Co.", "1 Mock Plaza"], taxId: "99-9999999" };
const money = (c) => (Math.round(c / 100)).toLocaleString("en-US");

const TYPES = {
  blank: price("blank"),
  retainer: price("retainer"),
  timesheet: price("timesheet", {
    activity: [
      { date: "2026-08-03", description: "Examined invented widget", hours: 2250, personid: 1, id: 1 },
      { date: "2026-08-04", description: "Drafted placeholder letter", hours: 1500, personid: 2, id: 2 },
      { date: "2026-08-05", description: "Phone call, no person", hours: 500, personid: null, id: 3 },
    ],
    funds: [{ date: "2026-08-01", type: "Check", amount: 20_000, id: 1 }],
    overrides: { 2: 31_100 },
  }),
  depoprep: price("depoprep"),
  depo: price("depo"),
  trial: price("trial"),
};

for (const [type, priced] of Object.entries(TYPES)) {
  test(`${type}: PDF text holds every stored line, every money figure, and 'Balance due' with the stored balance`, async () => {
    const db = world({ billtype: type, priced });
    const st = memStorage();
    const key = await inv.saveInvoicePdf(db, st, 900, CFG);
    const bill = db.tables.tblbills[0];
    assert.equal(bill.billpdfpath, key);
    assert.equal(st.files.get(key).type, "application/pdf");
    const t = pdfText(st.files.get(key).body);
    const all = t.join(" ");
    for (const l of priced.lines) {
      assert.ok(all.includes(l.description), `${type}: line text missing: ${l.description}`);
      if (l.amount) assert.ok(t.some((s) => s.startsWith(money(l.amount)) || s.startsWith(`$${money(l.amount)}`)), `${type}: amount ${money(l.amount)} missing: ${JSON.stringify(t)}`);
    }
    const i = t.indexOf("Balance due:");
    assert.ok(i >= 0, `${type}: no Balance due`);
    const bal = priced.balance;
    const want = `${bal < 0 ? "-" : ""}$${bal % 100 === 0 ? money(Math.abs(bal)) : (Math.abs(bal) / 100).toLocaleString("en-US", { minimumFractionDigits: 2 })}${priced.estimated ? "(est.)" : ""}`;
    assert.equal(t[i + 1], want, `${type}: balance`);
    assert.ok(!/\bnull\b|undefined|NaN/.test(all), `${type}: null text`);
    assert.equal(t.includes("Note:"), priced.estimated, `${type}: estimate note only on estimate bills`);
  });
}

test("timesheet: the admin-overridden rate prints as stored (1.5 hrs x $311/hr = 467), credit as a whole-dollar credit", async () => {
  const t = pdfText((await (async () => { const st = memStorage(); const k = await inv.saveInvoicePdf(world({ billtype: "timesheet", priced: TYPES.timesheet }), st, 900, CFG); return st.files.get(k).body; })()));
  for (const s of ["1.5 hrs x $311/hr", "467", "8/1/26", "200", "8/3/26", "2.25 hrs", "0.50 hrs"]) assert.ok(t.includes(s), `missing ${s}: ${JSON.stringify(t)}`);
});

test("collapse: no middle name, no title, no address2, no caption, no letterhead, no TAX ID → no blank rows or labels", async () => {
  const st = memStorage();
  const key = await inv.saveInvoicePdf(world({ billtype: "retainer", priced: TYPES.retainer, caption: "   ", atty: { attymiddlename: null, attytitle: null }, firm: { frmaddress2: null } }), st, 900, {});
  const t = pdfText(st.files.get(key).body);
  assert.ok(t.includes("Quill Examplar, Esq."), JSON.stringify(t));
  assert.ok(!t.some((s) => s.trim() === "" || /\bnull\b|undefined|TAX ID|Floor 2|Invented Engineering/.test(s)), JSON.stringify(t));
  assert.ok(!t.some((s) => /:\s*$/.test(s) && s !== "Balance due:"), `blank label: ${JSON.stringify(t)}`);
});

test("collapse: the case's attorney row is missing → no address block, no 'null', PDF still made", async () => {
  const st = memStorage();
  const db = world({ billtype: "retainer", priced: TYPES.retainer, noAtty: true });
  const key = await inv.saveInvoicePdf(db, st, 900, CFG);
  const t = pdfText(st.files.get(key).body);
  assert.ok(!t.some((s) => /\bnull\b|undefined|Esq\.|Mockery/.test(s)), JSON.stringify(t));
});

test("45 detail lines + long description + long names: spans pages, every line printed once, header and footer on each page", async () => {
  const long = "Inspected the invented apparatus at the placeholder facility and documented every sample measurement in the fixture notebook for later review";
  const activity = Array.from({ length: 45 }, (_, i) => ({ date: `2026-07-${String((i % 28) + 1).padStart(2, "0")}`, description: i === 7 ? long : `Invented task number ${i + 1}`, hours: 1250, personid: 1, id: i + 1 }));
  const priced = price("timesheet", { activity });
  const st = memStorage();
  const key = await inv.saveInvoicePdf(world({ billtype: "timesheet", priced, atty: { attyfirstname: "Maximiliana-Evangelina", attylastname: "Wolfeschlegelsteinhausen-Bergerdorff" }, firm: { frmname: "The Extraordinarily Long Invented Partnership of Sample, Mock, Stub & Fixture LLP" } }), st, 900, CFG);
  const buf = st.files.get(key).body;
  const t = pdfText(buf);
  const pages = pageCount(buf);
  assert.ok(pages >= 2, `pages ${pages}`);
  for (let i = 1; i <= 45; i++) if (i !== 8) assert.equal(t.filter((s) => s === `Invented task number ${i}`).length, 1, `task ${i}`);
  assert.ok(t.join(" ").replace(/\s+/g, " ").includes(long), "long description wrapped but complete");
  assert.equal(t.filter((s) => s === "REFERENCE").length, pages, "table header on every page");
  assert.equal(t.filter((s) => s === "THANK YOU").length, pages, "footer on every page");
  assert.ok(t.includes("56.25 hrs x $435/hr") && t.includes("24,469"), JSON.stringify(t.slice(-12)));
  const i = t.indexOf("Balance due:");
  assert.equal(t[i + 1], "$24,469");
});

test("-N suffix: two bills made the app's way for the same case, attorney and date get distinct names and distinct PDF keys (-0, -1)", async () => {
  // As createBill does: the name is computed before the row is inserted.
  const db = world({ billtype: "retainer", priced: TYPES.retainer });
  const [b0] = db.tables.tblbills.splice(0);
  b0.billfilename = await fileNameFor(db, CASE, "Examplar", DATE);
  db.tables.tblbills.push(b0);
  db.tables.tblbills.push({ ...b0, billid: 901, billfilename: await fileNameFor(db, CASE, "Examplar", DATE), billpdfpath: null });
  db.tables.tblbilllines.push(...rowsOf(901, TYPES.retainer.lines));
  const st = memStorage();
  const k1 = await inv.saveInvoicePdf(db, st, 900, CFG), k2 = await inv.saveInvoicePdf(db, st, 901, CFG);
  assert.deepEqual(db.tables.tblbills.map((b) => b.billfilename), [`Bill${CASE} Examplar 2026 09 07-0`, `Bill${CASE} Examplar 2026 09 07-1`]);
  assert.notEqual(k1, k2);
  assert.equal(st.files.size, 2);
});

test("a second bill never overwrites another bill's stored PDF (bill 1's date was corrected after it was created)", async () => {
  // Bill 900 was created on DATE (-0) and later re-dated to the 8th; bill 901 created on DATE also counts 0 bills → -0.
  const db = world({ billtype: "retainer", priced: TYPES.retainer });
  const [b0] = db.tables.tblbills.splice(0);
  b0.billfilename = await fileNameFor(db, CASE, "Examplar", DATE);
  db.tables.tblbills.push(b0);
  b0.billdate = "2026-09-08"; // "Update bill" date correction; the stored file name keeps the old date
  db.tables.tblbills.push({ ...b0, billid: 901, billdate: DATE, billfilename: await fileNameFor(db, CASE, "Examplar", DATE), billpdfpath: null });
  db.tables.tblbilllines.push(...rowsOf(901, TYPES.retainer.lines));
  const st = memStorage();
  const k1 = await inv.saveInvoicePdf(db, st, 900, CFG), k2 = await inv.saveInvoicePdf(db, st, 901, CFG);
  assert.notEqual(k1, k2, `both bills' billpdfpath = ${k1}: bill 901's PDF overwrote bill 900's`);
});
