// Item 7: service authorization document (lib/bill-docs/service-auth.ts) and the legacy approval-date rule
// (lib/cases/service-auths.ts saveServiceAuth). Fake PostgREST + in-memory store; PDF text read with node:zlib only.
// Synthetic fixtures; every name/figure below is invented.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { inflateSync } from "node:zlib";

const SA = await import("../../lib/cases/service-auths.ts");
const doc = await import("../../lib/bill-docs/service-auth.ts");

/** Stateful fake PostgREST. `fail.insert` → the insert answers with an error (after committing when `fail.commit`). */
function fakeDb(tables, fail = {}) {
  let nextId = 7000;
  return {
    tables,
    from(table) {
      const q = { filters: [], orders: [], insert: null, update: null, single: false };
      const b = new Proxy({}, {
        get(_, k) {
          if (k === "then") {
            const all = (tables[table] ??= []);
            let rows, error = null;
            if (q.insert) {
              rows = [q.insert].flat().map((r) => ({ srvauthid: nextId++, ...r }));
              if (!fail.insert || fail.commit) all.push(...rows);
              if (fail.insert) error = { message: "boom" };
            } else if (table === "tblsrvauth" && fail.check && q.filters.length === 2) {
              error = { message: "check down" };
            } else {
              rows = all.filter((r) => q.filters.every((f) => f(r)));
              if (q.update) for (const r of rows) Object.assign(r, q.update);
              for (const [col, asc] of [...q.orders].reverse()) rows = [...rows].sort((x, y) => (x[col] < y[col] ? -1 : x[col] > y[col] ? 1 : 0) * (asc ? 1 : -1));
            }
            const data = error ? null : q.single ? (rows[0] ? { ...rows[0] } : null) : rows.map((r) => ({ ...r }));
            return (res, rej) => Promise.resolve({ data, error }).then(res, rej);
          }
          return (...a) => {
            if (k === "eq") q.filters.push((r) => r[a[0]] === a[1]);
            if (k === "is") q.filters.push((r) => (r[a[0]] ?? null) === a[1]);
            if (k === "in") q.filters.push((r) => a[1].includes(r[a[0]]));
            if (k === "order") q.orders.push([a[0], a[1]?.ascending !== false]);
            if (k === "insert") q.insert = a[0];
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
/** In-memory SaStore: `create` refuses an existing key, like upload with upsert:false. */
const fakeStore = (pre = []) => {
  const files = new Map(pre.map((k) => [k, Buffer.from("other")]));
  return { files, removed: [], create: async (k, b) => (files.has(k) ? false : (files.set(k, Buffer.from(b)), true)), async remove(k) { this.removed.push(k); files.delete(k); } };
};

const WIN = { 0x91: "‘", 0x92: "’", 0x93: "“", 0x94: "”", 0x96: "–", 0x97: "—", 0x85: "…" };
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

const CASE = 992701;
const NOW = new Date("2026-09-30T16:00:00Z"); // firm today 2026-09-30
const act = (actid, actdate, acthrs, actdescription, billed = {}) => ({ actid, actcaseid: CASE, actdate, actdescription, acthrs, actwho: 1, actbilled: false, actbillid: null, ...billed });
const world = (o = {}) => fakeDb({
  tblcase: [{ caseid: CASE, casetitle: "Invented v. Fixture/Co", casecaption: "Sample Caption", casestartdate: o.start ?? "2026-01-10", caseatty: 41, billingalert: false, billingcc: null }],
  tblattorney: [{ attyid: 41, attyfirstname: "Rowan", attylastname: "O'Test-wood", attyfirmid: 51 }],
  tblfirm: [{ frmid: 51, frmname: "Placeholder & Sample LLP", frmphone: "000-555-0100" }],
  tblactivity: [
    act(1, "2026-08-11", "1.500", "Drafted sample memo"),
    act(2, "2026-08-10", "2.000", "Reviewed invented deposition"),
    act(3, "2026-08-12", "0.125", "Call with fixture counsel"),
    act(4, "2026-08-09", "9.000", "ALREADY BILLED flag", { actbilled: true }),
    act(5, "2026-08-08", "8.000", "ALREADY BILLED id", { actbillid: 99 }),
  ],
  tblbillingnames: [{ personid: 1, initials: "AAA" }],
  tblsrvauth: o.sa ?? [],
}, o.fail);
const CFG = { letterhead: ["Sample Consulting Co.", "1 Nowhere Plaza"], taxId: "00-0000000" };
const BASE = `SA${CASE} OTest wood 2026 09 30`;

test("done-when: Create SA → PDF with caption, case number, rate and each unbilled row; new Awaiting Approval row whose srvauthfile is the stored object", async () => {
  const db = world(), store = fakeStore();
  const r = await doc.createServiceAuth(db, store, CASE, NOW, CFG);
  assert.equal(r.srvauthfile, `${BASE}-0`);
  const key = `service-auths/${CASE}/${BASE}-0.pdf`;
  assert.deepEqual([...store.files.keys()], [key]);
  const t = pdfText(store.files.get(key));
  const all = t.join("\n");
  for (const s of ["Sample Caption / Invented v. Fixture-Co / #992701", "Rowan O'Test-wood, Esq. / (000) 555-0100", "Placeholder & Sample LLP",
    "$435/hr", "8/10/26", "Reviewed invented deposition", "2.00", "8/11/26", "Drafted sample memo", "1.50", "8/12/26", "Call with fixture counsel", "0.13",
    "9/30/2026", "Tax ID # 00-0000000", "Sample Consulting Co."]) assert.ok(all.includes(s), `missing "${s}" in ${JSON.stringify(t)}`);
  assert.ok(!all.includes("ALREADY BILLED"), "billed rows (either flag) never print");
  assert.ok(all.indexOf("8/10/26") < all.indexOf("8/11/26") && all.indexOf("8/11/26") < all.indexOf("8/12/26"), "oldest first");
  const row = db.tables.tblsrvauth.find((x) => x.srvauthid === r.srvauthid);
  assert.deepEqual({ ...row, srvauthid: 0 }, { srvauthid: 0, srvauthcaseid: CASE, srvauthdate: "2026-09-30", srvauthhours: "3.625", srvauthstatus: "Awaiting Approval", srvauthfile: `${BASE}-0` });
  assert.equal(SA.saKey(CASE, row.srvauthfile), key);
});

test("rate is the item-2 default for today: a case started over 2 years ago prints the late rate", async () => {
  const store = fakeStore();
  await doc.createServiceAuth(world({ start: "2024-01-10" }), store, CASE, NOW, CFG);
  assert.ok(pdfText([...store.files.values()][0]).join("\n").includes("$475/hr"));
});

test("next free -N: a row's name (any case) and an existing object are both skipped; nothing is overwritten", async () => {
  const db = world({ sa: [{ srvauthid: 1, srvauthcaseid: CASE, srvauthfile: `${BASE.toUpperCase()}-0` }] });
  const store = fakeStore([`service-auths/${CASE}/${BASE}-1.pdf`]);
  const r = await doc.createServiceAuth(db, store, CASE, NOW, CFG);
  assert.equal(r.srvauthfile, `${BASE}-2`);
  assert.equal(store.files.get(`service-auths/${CASE}/${BASE}-1.pdf`).toString(), "other");
});

test("insert fails cleanly → the uploaded object is removed, create-failed, no row", async () => {
  const db = world({ fail: { insert: true } }), store = fakeStore();
  await assert.rejects(doc.createServiceAuth(db, store, CASE, NOW, CFG), (e) => e.code === "create-failed");
  assert.equal(store.files.size, 0);
  assert.deepEqual(store.removed, [`service-auths/${CASE}/${BASE}-0.pdf`]);
  assert.equal(db.tables.tblsrvauth.length, 0);
});

test("insert answered with an error but committed → success, object kept", async () => {
  const db = world({ fail: { insert: true, commit: true } }), store = fakeStore();
  const r = await doc.createServiceAuth(db, store, CASE, NOW, CFG);
  assert.equal(r.srvauthfile, `${BASE}-0`);
  assert.equal(store.files.size, 1);
  assert.equal(store.removed.length, 0);
});

test("insert failed and the check failed → create-unknown, object kept (never a row pointing at nothing)", async () => {
  const db = world({ fail: { insert: true, check: true } }), store = fakeStore();
  await assert.rejects(doc.createServiceAuth(db, store, CASE, NOW, CFG), (e) => e.code === "create-unknown");
  assert.equal(store.files.size, 1);
  assert.equal(store.removed.length, 0);
});

test("no storage → create-storage, nothing written; unknown case → notfound", async () => {
  const db = world();
  await assert.rejects(doc.createServiceAuth(db, null, CASE, NOW, CFG), (e) => e.code === "create-storage");
  await assert.rejects(doc.createServiceAuth(db, fakeStore(), 1, NOW, CFG), (e) => e.code === "notfound");
  assert.equal(db.tables.tblsrvauth.length, 0);
});

test("runCreateSa: any session (no role asked), redirects to the SA panel with sa_new / sa_error", async () => {
  const urls = [], roles = [], paths = [];
  const deps = (o = {}) => ({
    session: async (...a) => { roles.push(a.length); return {}; }, db: () => world(), store: () => fakeStore(), config: () => CFG, now: () => NOW,
    revalidatePath: (p) => paths.push(p), redirect: (u) => { urls.push(u); throw new Error("NEXT_REDIRECT"); }, ...o,
  });
  await assert.rejects(doc.runCreateSa(CASE, deps()), /NEXT_REDIRECT/);
  assert.match(urls[0], new RegExp(`^/cases/${CASE}\\?sa_new=\\d+&t=\\d+#service-auths$`));
  assert.deepEqual(paths, [`/cases/${CASE}`, "/cases/service-auths"]);
  await assert.rejects(doc.runCreateSa(CASE, deps({ store: () => null })), /NEXT_REDIRECT/);
  assert.match(urls[1], /\?sa_error=create-storage&/);
  assert.deepEqual(roles, [0, 0]);
  assert.match(SA.saErrorMessage("create-unknown"), /may or may not/);
});

test("file name follows the VBA: '-' and '_' → space, '/' and \"'\" dropped, accents stripped for the key", () => {
  assert.equal(SA.saFileBase(12, "Mc_Test-Name/O'Neil", "2026-01-02"), "SA12 Mc Test NameONeil 2026 01 02");
  assert.equal(SA.saFileBase(12, "Muñoz", "2026-01-02"), "SA12 Munoz 2026 01 02");
  assert.ok(SA.isAppSaFile(12, "SA12 Munoz 2026 01 02-3"));
  assert.ok(!SA.isAppSaFile(12, "SA Munoz 2026 01 02-0") && !SA.isAppSaFile(12, "SA123 X 2026 01 02-0") && !SA.isAppSaFile(12, null));
  assert.equal(SA.fmtPhone("(000) 555 0100"), "(000) 555-0100");
  assert.equal(SA.fmtPhone("ext 12"), "ext 12");
  assert.equal(SA.shortDate("2026-03-06"), "3/6/2026");
});

test("pdf-lib stays out of the SA rule module and what it imports (the case page and /cases/service-auths import it)", () => {
  for (const f of ["lib/cases/service-auths.ts", "lib/bills/rules.ts", "lib/cases/record.ts"])
    assert.doesNotMatch(readFileSync(new URL(`../../${f}`, import.meta.url), "utf8"), /^import .*(pdf-lib|bill-docs)/m, f);
});

// ---- approval-date rule (legacy SrvAuthStatus_AfterUpdate) ----
const TODAY = "2026-09-11";
const ROW = { srvauthid: 7, srvauthcaseid: 90001, srvauthdate: "2026-08-01", srvauthhours: 1, srvauthfile: null, srvauthstatus: "Awaiting Approval", srvdateapproved: null, srvadvance: null, srvauthnotes: null };
const saDb = (row) => fakeDb({ tblsrvauth: [{ ...row }], tblcase: [{ caseid: 90001 }] });
function editForm(row, overrides = {}) {
  const f = new FormData();
  f.set("srvauthid", String(row.srvauthid));
  for (const fl of SA.SA_FIELDS) { f.set(fl.col, SA.saValue(fl, row)); f.set(`${fl.col}__orig`, SA.saValue(fl, row)); }
  for (const [k, v] of Object.entries(overrides)) f.set(k, v);
  return f;
}
const edit = async (row, o) => (await SA.saveServiceAuth(saDb(row), 90001, editForm(row, o), TODAY)).written;

test("done-when: Declined stamps today when empty; back to Awaiting Approval clears it; Approved on a dated row keeps the date", async () => {
  assert.deepEqual(await edit(ROW, { srvauthstatus: "Declined" }), { srvauthstatus: "Declined", srvdateapproved: TODAY });
  const declined = { ...ROW, srvauthstatus: "Declined", srvdateapproved: TODAY };
  assert.deepEqual(await edit(declined, { srvauthstatus: "Awaiting Approval" }), { srvauthstatus: "Awaiting Approval", srvdateapproved: null });
  const dated = { ...ROW, srvauthstatus: "Declined", srvdateapproved: "2026-02-03" };
  assert.deepEqual(await edit(dated, { srvauthstatus: "Approved" }), { srvauthstatus: "Approved" });
});

test("stamp set is exactly Approved / Declined / Modified / Modified and Approved (any case); every other status clears", async () => {
  for (const s of ["Approved", "declined", "Modified", "MODIFIED AND APPROVED"])
    assert.equal((await edit(ROW, { srvauthstatus: s })).srvdateapproved, TODAY, s);
  const dated = { ...ROW, srvauthstatus: "Approved", srvdateapproved: "2026-02-03" };
  for (const s of ["Awaiting Approval", "Approved without advance", "Replaced"])
    assert.deepEqual(await edit(dated, { srvauthstatus: s }), { srvauthstatus: s, srvdateapproved: null }, s);
  // Nothing to clear → nothing extra written.
  assert.deepEqual(await edit({ ...ROW, srvauthstatus: "Declined" }, { srvauthstatus: "Replaced" }), { srvauthstatus: "Replaced" });
});

test("status unchanged → date untouched; a date typed in the same save wins; add with Declined stamps", async () => {
  const dated = { ...ROW, srvdateapproved: "2026-02-03" };
  assert.deepEqual(await edit(dated, { srvauthnotes: "x" }), { srvauthnotes: "x" });
  assert.deepEqual(await edit(dated, { srvauthstatus: "Replaced", srvdateapproved: "2026-05-05" }), { srvauthstatus: "Replaced", srvdateapproved: "2026-05-05" });
  const add = new FormData();
  for (const fl of SA.SA_FIELDS) add.set(fl.col, "");
  add.set("srvauthdate", "2026-09-01"); add.set("srvauthhours", "1"); add.set("srvauthstatus", "Declined");
  assert.equal((await SA.saveServiceAuth(saDb(ROW), 90001, add, TODAY)).written.srvdateapproved, TODAY);
});
