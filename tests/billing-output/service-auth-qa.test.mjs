// Item 7 QA (independent of the engineer's tests): Create SA document + storage + row, legacy approval-date rule,
// the invoice refactor (byte-identical to the pre-item-7 renderer), no email path, no pdf-lib in the SA rules module.
// Fake PostgREST + in-memory store; PDF text read with node:zlib. Every name/figure below is invented.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { join, dirname, resolve } from "node:path";
import { inflateSync } from "node:zlib";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const SA = await import("../../lib/cases/service-auths.ts");
const doc = await import("../../lib/bill-docs/service-auth.ts");
const { renderInvoice } = await import("../../lib/bill-docs/invoice.ts");
const { defaultRates } = await import("../../lib/bills/rates.ts");

// ---- fakes ----
function fakeDb(tables, fail = {}) {
  let nextId = 5100;
  const calls = [];
  return {
    tables, calls,
    from(table) {
      const q = { filters: [], insert: null, update: null, single: false };
      calls.push(table);
      const b = new Proxy({}, {
        get(_, k) {
          if (k === "then") {
            const all = (tables[table] ??= []);
            let rows, error = null;
            if (q.insert) {
              rows = [q.insert].flat().map((r) => ({ srvauthid: nextId++, ...r }));
              if (!fail.insert || fail.commit) all.push(...rows);
              if (fail.insert) error = { message: "insert boom" };
            } else if (table === "tblsrvauth" && fail.check && q.filters.length === 2) {
              error = { message: "check down" };
            } else {
              rows = all.filter((r) => q.filters.every((f) => f(r)));
              if (q.update) for (const r of rows) Object.assign(r, q.update);
            }
            const data = error ? null : q.single ? (rows[0] ? { ...rows[0] } : null) : rows.map((r) => ({ ...r }));
            return (res, rej) => Promise.resolve({ data, error }).then(res, rej);
          }
          return (...a) => {
            if (k === "eq") q.filters.push((r) => r[a[0]] === a[1]);
            if (k === "is") q.filters.push((r) => (r[a[0]] ?? null) === a[1]);
            if (k === "in") q.filters.push((r) => a[1].includes(r[a[0]]));
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
const fakeStore = (pre = []) => {
  const files = new Map(pre.map((k) => [k, Buffer.from("someone else's file")]));
  return { files, removed: [], create: async (k, bytes) => (files.has(k) ? false : (files.set(k, Buffer.from(bytes)), true)), async remove(k) { this.removed.push(k); files.delete(k); } };
};
function pdfText(buf) {
  const out = [];
  const s = Buffer.from(buf).toString("latin1");
  for (const m of s.matchAll(/stream\r?\n/g)) {
    const start = m.index + m[0].length;
    let body = Buffer.from(s.slice(start, s.indexOf("endstream", start)), "latin1");
    try { body = inflateSync(body); } catch { continue; }
    for (const t of body.toString("latin1").matchAll(/<([0-9A-Fa-f]*)> Tj/g)) out.push(Buffer.from(t[1], "hex").toString("latin1"));
  }
  return out.join("\n");
}

const CASE = 993711, OTHER = 993712;
const NOW = new Date("2026-09-30T16:00:00Z"); // firm today 2026-09-30
const act = (actid, actdate, acthrs, actdescription, o = {}) => ({ actid, actcaseid: CASE, actdate, actdescription, acthrs, actwho: 1, actbilled: false, actbillid: null, ...o });
const world = ({ start = "2026-02-01", last = "Quillon", sas = [] } = {}) => fakeDb({
  tblcase: [{ caseid: CASE, casetitle: "Nobody v. Example/Holdings", casecaption: "Court of Samples No. Z-9", casestartdate: start, caseatty: 61, billingalert: false, billingcc: null },
    { caseid: OTHER, casetitle: "Other v. Case", casecaption: "Cap", casestartdate: start, caseatty: 61, billingalert: false, billingcc: null }],
  tblattorney: [{ attyid: 61, attyfirstname: "Pat", attylastname: last, attyfirmid: 71 }],
  tblfirm: [{ frmid: 71, frmname: "Invented Partners PLLC", frmphone: "0005550142" }],
  tblactivity: [
    act(1, "2026-09-02", "1.500", "Inspected invented widget"),
    act(2, "2026-09-03", "0.750", "Wrote placeholder findings"),
    act(3, "2026-08-01", "9.000", "BILLED FLAG ROW", { actbilled: true }),
    act(4, "2026-08-02", "4.000", "BILL ID ROW", { actbillid: 42 }),
    act(5, "2026-08-03", "3.000", "BOTH BILLED ROW", { actbilled: true, actbillid: 42 }),
    act(6, "2026-09-04", "2.000", "OTHER CASE ROW", { actcaseid: OTHER }),
  ],
  tblsrvauth: sas,
});
const CFG = { letterhead: ["Invented Consulting Co.", "9 Sample Row"], taxId: "00-0000000" };
const sas = (db) => db.tables.tblsrvauth;

// ---- done-when 1: PDF content, row, stored object ----
test("Create SA: PDF has caption, case #, rate, each unbilled row (not billed/other-case rows); Awaiting row's srvauthfile names the stored object", async () => {
  const db = world(), store = fakeStore();
  const r = await doc.createServiceAuth(db, store, CASE, NOW, CFG);
  const row = sas(db).find((x) => x.srvauthid === r.srvauthid);
  assert.equal(row.srvauthstatus, "Awaiting Approval");
  assert.equal(row.srvauthdate, "2026-09-30");
  assert.equal(Number(row.srvauthhours), 2.25, "requested hours = sum of unbilled rows only");
  assert.equal(row.srvdateapproved ?? null, null);
  assert.equal(row.srvauthcaseid, CASE);
  assert.equal(row.srvauthfile, r.srvauthfile);
  assert.deepEqual([...store.files.keys()], [`service-auths/${CASE}/${row.srvauthfile}.pdf`]);
  const text = pdfText(store.files.get(SA.saKey(CASE, row.srvauthfile)));
  const rate = defaultRates("2026-09-30", "2026-02-01").standard;
  for (const s of ["Court of Samples No. Z-9 / Nobody v. Example-Holdings / #993711", "Pat Quillon, Esq. / (000) 555-0142", "Invented Partners PLLC",
    `$${rate / 100}/hr`, "9/2/26", "Inspected invented widget", "1.50", "9/3/26", "Wrote placeholder findings", "0.75", "9/30/2026"])
    assert.ok(text.includes(s), `PDF missing "${s}"`);
  for (const s of ["BILLED FLAG ROW", "BILL ID ROW", "BOTH BILLED ROW", "OTHER CASE ROW"]) assert.ok(!text.includes(s), `PDF must not list "${s}"`);
});

test("Create SA: rate is the item-2 default for today — a case past its late date prints the late rate", async () => {
  const late = defaultRates("2026-09-30", "2022-01-01").standard, std = defaultRates("2026-09-30", "2026-02-01").standard;
  assert.notEqual(late, std);
  const store = fakeStore();
  const r = await doc.createServiceAuth(world({ start: "2022-01-01" }), store, CASE, NOW, CFG);
  const text = pdfText(store.files.get(SA.saKey(CASE, r.srvauthfile)));
  assert.ok(text.includes(`$${late / 100}/hr`) && !text.includes(`$${std / 100}/hr`), text.slice(0, 400));
});

// ---- naming ----
test("name: SA<caseid> <last> <yyyy mm dd>-N with legacy sanitizing (- _ → space, / ' dropped)", async () => {
  const r = await doc.createServiceAuth(world({ last: "D'Arc-Lee_Jr/X" }), fakeStore(), CASE, NOW, CFG);
  assert.equal(r.srvauthfile, `SA${CASE} DArc Lee JrX 2026 09 30-0`);
});

test("duplicates: consecutive creates get -0, -1, -2; a name held by a row (any case) or by an object is skipped, never overwritten", async () => {
  const db = world(), store = fakeStore();
  const names = [];
  for (let i = 0; i < 3; i++) names.push((await doc.createServiceAuth(db, store, CASE, NOW, CFG)).srvauthfile);
  const base = `SA${CASE} Quillon 2026 09 30`;
  assert.deepEqual(names, [`${base}-0`, `${base}-1`, `${base}-2`]);
  assert.equal(store.files.size, 3);

  // -0 held by a row in other case; -1 is someone's object with no row; -2 name used by a lowercase row on this case
  const held = SA.saKey(CASE, `${base}-1`);
  const db2 = world({ sas: [{ srvauthid: 1, srvauthcaseid: CASE, srvauthfile: `${base}-0` }, { srvauthid: 2, srvauthcaseid: CASE, srvauthfile: `${base}-2`.toLowerCase() }] });
  const store2 = fakeStore([held]);
  const r = await doc.createServiceAuth(db2, store2, CASE, NOW, CFG);
  assert.equal(r.srvauthfile, `${base}-3`);
  assert.equal(store2.files.get(held).toString(), "someone else's file", "existing object untouched");
  // A same-named file on ANOTHER case does not push the -N (the key carries the case id).
  const db3 = world({ sas: [{ srvauthid: 3, srvauthcaseid: OTHER, srvauthfile: `${base}-0` }] });
  assert.equal((await doc.createServiceAuth(db3, fakeStore(), CASE, NOW, CFG)).srvauthfile, `${base}-0`);
});

// ---- insert failure compensation ----
test("insert fails cleanly → orphan object removed, create-failed, no row", async () => {
  const db = world(), store = fakeStore();
  const orig = console.error; console.error = () => {};
  try {
    await assert.rejects(doc.createServiceAuth(fakeDb(db.tables, { insert: true }), store, CASE, NOW, CFG), (e) => e.code === "create-failed");
  } finally { console.error = orig; }
  assert.equal(store.files.size, 0);
  assert.equal(store.removed.length, 1);
  assert.equal(sas(db).length, 0);
});
test("insert errors but committed → success with the committed row, object kept", async () => {
  const db = world(), store = fakeStore();
  const r = await doc.createServiceAuth(fakeDb(db.tables, { insert: true, commit: true }), store, CASE, NOW, CFG);
  assert.equal(sas(db).length, 1);
  assert.equal(sas(db)[0].srvauthid, r.srvauthid);
  assert.ok(store.files.has(SA.saKey(CASE, r.srvauthfile)));
  assert.equal(store.removed.length, 0);
});
test("insert errors and the check errors → create-unknown, object kept (never a row without its file)", async () => {
  const db = world(), store = fakeStore();
  const orig = console.error; console.error = () => {};
  try {
    await assert.rejects(doc.createServiceAuth(fakeDb(db.tables, { insert: true, check: true }), store, CASE, NOW, CFG), (e) => e.code === "create-unknown");
  } finally { console.error = orig; }
  assert.equal(store.files.size, 1);
  assert.equal(store.removed.length, 0);
});

// ---- server action body: session first, any role, no email ----
const deps = (db, store, session) => {
  const urls = [];
  return { urls, d: { session, db: () => db, store: () => store, config: () => CFG, now: () => NOW, revalidatePath: () => {}, redirect: (u) => { urls.push(u); throw new Error("NEXT_REDIRECT"); } } };
};
test("runCreateSa: a staff session creates (no admin check); no session → nothing read or written", async () => {
  const db = world(), store = fakeStore();
  const { urls, d } = deps(db, store, async () => ({ userId: "u", role: "staff" }));
  await assert.rejects(doc.runCreateSa(CASE, d), /NEXT_REDIRECT/);
  assert.match(urls[0], new RegExp(`^/cases/${CASE}\\?sa_new=\\d+&t=\\d+#service-auths$`));
  assert.equal(sas(db).length, 1);

  const db2 = world(), store2 = fakeStore();
  const x = deps(db2, store2, async () => { throw new Error("LOGIN_REDIRECT"); });
  await assert.rejects(doc.runCreateSa(CASE, x.d), /LOGIN_REDIRECT/);
  assert.deepEqual([db2.calls.length, store2.files.size, x.urls.length], [0, 0, 0]);
});
test("action wiring: createServiceAuthAction uses requireSession (not an admin gate); download route calls requireSession before any read", () => {
  const act = readFileSync(join(ROOT, "app/cases/[id]/actions.ts"), "utf8");
  const body = act.slice(act.indexOf("export async function createServiceAuthAction"), act.indexOf("export async function saveServiceAuthAction"));
  assert.match(body, /session: \(\) => requireSession\(\)/);
  assert.doesNotMatch(body, /requireAdmin|role/);
  const route = readFileSync(join(ROOT, "app/cases/service-auths/pdf/[srvauthid]/route.ts"), "utf8");
  const get = route.slice(route.indexOf("export async function GET"));
  assert.ok(get.indexOf("await requireSession()") > 0 && get.indexOf("await requireSession()") < get.indexOf("saPdfKey("), "session check precedes the lookup");
});

/** Non-type imports reachable from `entry` (repo files resolved; bare packages recorded by name). */
function importGraph(entry) {
  const seen = new Set(), pkgs = new Set(), stack = [resolve(ROOT, entry)];
  const find = (from, spec) => {
    const base = spec.startsWith("@/") ? join(ROOT, spec.slice(2)) : resolve(dirname(from), spec);
    for (const p of [base, `${base}.ts`, `${base}.tsx`, join(base, "index.ts")]) if (existsSync(p) && !p.endsWith("/") && /\.tsx?$/.test(p)) return p;
    return null;
  };
  while (stack.length) {
    const f = stack.pop();
    if (seen.has(f)) continue;
    seen.add(f);
    const src = readFileSync(f, "utf8");
    for (const m of src.matchAll(/^\s*(?:import|export)\s+(type\s+)?(?:[^'";]*?\s+from\s+)?["']([^"']+)["']/gm)) {
      if (m[1]) continue;
      const spec = m[2];
      if (spec.startsWith(".") || spec.startsWith("@/")) { const p = find(f, spec); if (p) stack.push(p); } else pkgs.add(spec);
    }
  }
  return { files: [...seen].map((f) => f.slice(ROOT.length)), pkgs };
}
test("guardrail: lib/cases/service-auths.ts (rules, lists) never pulls in pdf-lib", () => {
  const g = importGraph("lib/cases/service-auths.ts");
  assert.ok(!g.pkgs.has("pdf-lib"), `pdf-lib reached via ${g.files.join(", ")}`);
});
test("guardrail: no SA path reaches the email sender (lib/bills/send, sendWithGuard, runSend)", () => {
  for (const entry of ["lib/bill-docs/service-auth.ts", "app/cases/service-auths/pdf/[srvauthid]/route.ts", "app/cases/[id]/service-auths.tsx"]) {
    const g = importGraph(entry);
    assert.ok(!g.files.includes("lib/bills/send.ts"), `${entry} reaches lib/bills/send.ts`);
    for (const f of g.files.filter((x) => !x.startsWith("lib/bill-docs/send.ts") && !x.startsWith("lib/bills/") && !x.startsWith("app/bills/")))
      assert.doesNotMatch(readFileSync(join(ROOT, f), "utf8"), /\b(sendWithGuard|runSend)\s*\(/, `${f} (from ${entry}) calls a sender`);
  }
});
test("guardrail: Create SA makes no network call (no email provider is contacted)", async () => {
  const orig = globalThis.fetch, hits = [];
  globalThis.fetch = async (...a) => { hits.push(String(a[0])); throw new Error("no network in this test"); };
  try {
    const { d } = deps(world(), fakeStore(), async () => ({ role: "staff" }));
    await assert.rejects(doc.runCreateSa(CASE, d), /NEXT_REDIRECT/);
  } finally { globalThis.fetch = orig; }
  assert.deepEqual(hits, []);
});

// ---- done-when 2: approval-date rule (saveServiceAuth, add + edit) ----
const T = "2026-09-30";
const ROW = { srvauthid: 901, srvauthcaseid: CASE, srvauthdate: "2026-09-01", srvauthhours: "3.000", srvauthstatus: "Awaiting Approval", srvdateapproved: null, srvauthfile: null, srvadvance: null, srvauthnotes: null };
const saDb = (row) => fakeDb({ tblcase: [{ caseid: CASE }], tblsrvauth: [{ ...row }] });
function editForm(row, over) {
  const f = new FormData();
  f.set("srvauthid", String(row.srvauthid));
  for (const fl of SA.SA_FIELDS) { f.set(fl.col, SA.saValue(fl, row)); f.set(`${fl.col}__orig`, SA.saValue(fl, row)); }
  for (const [k, v] of Object.entries(over)) f.set(k, v);
  return f;
}
const edit = async (row, over) => { const db = saDb(row); await SA.saveServiceAuth(db, CASE, editForm(row, over), T); return db.tables.tblsrvauth[0]; };

test("done-when: Declined stamps today when empty; back to Awaiting Approval clears; Approved on a dated row keeps the date", async () => {
  const declined = await edit(ROW, { srvauthstatus: "Declined" });
  assert.equal(declined.srvdateapproved, T);
  const back = await edit(declined, { srvauthstatus: "Awaiting Approval" });
  assert.equal(back.srvdateapproved, null);
  const dated = { ...back, srvdateapproved: "2026-03-04" };
  assert.equal((await edit(dated, { srvauthstatus: "Approved" })).srvdateapproved, "2026-03-04");
});
test("legacy status set: Approved/Declined/Modified/Modified and Approved stamp an empty date; Approved without advance / Replaced / Awaiting clear", async () => {
  for (const s of ["Approved", "Declined", "Modified", "Modified and Approved"]) assert.equal((await edit(ROW, { srvauthstatus: s })).srvdateapproved, T, s);
  const dated = { ...ROW, srvauthstatus: "Declined", srvdateapproved: "2026-05-06" };
  for (const s of ["Approved without advance", "Replaced", "Awaiting Approval"]) assert.equal((await edit(dated, { srvauthstatus: s })).srvdateapproved, null, s);
  assert.equal((await edit({ ...dated, srvauthstatus: "Approved" }, { srvauthstatus: "Declined" })).srvdateapproved, "2026-05-06", "stamping→stamping keeps");
});
test("rule runs only on a status change; a typed date in the same save wins", async () => {
  const dated = { ...ROW, srvdateapproved: "2026-05-06" };
  assert.equal((await edit(dated, { srvauthnotes: "invented note" })).srvdateapproved, "2026-05-06", "Awaiting + date, status untouched: not cleared");
  assert.equal((await edit(ROW, { srvauthstatus: "Declined", srvdateapproved: "2026-07-08" })).srvdateapproved, "2026-07-08");
  assert.equal((await edit(dated, { srvauthstatus: "Replaced", srvdateapproved: "2026-07-09" })).srvdateapproved, "2026-07-09");
});
test("add path: Declined stamps today; Awaiting Approval gets no date", async () => {
  const add = async (status, date = "") => {
    const db = fakeDb({ tblcase: [{ caseid: CASE }], tblsrvauth: [] });
    const f = new FormData();
    for (const fl of SA.SA_FIELDS) f.set(fl.col, "");
    f.set("srvauthdate", "2026-09-29"); f.set("srvauthhours", "1.000"); f.set("srvauthstatus", status); f.set("srvdateapproved", date);
    await SA.saveServiceAuth(db, CASE, f, T);
    return db.tables.tblsrvauth[0];
  };
  assert.equal((await add("Declined")).srvdateapproved, T);
  assert.equal((await add("Modified")).srvdateapproved, T);
  assert.equal((await add("Awaiting Approval")).srvdateapproved ?? null, null);
});

// ---- invoice refactor: same bytes as the pre-item-7 renderer ----
const OLD = join(ROOT, "node_modules/.cache/i7qa-old-invoice");
after(() => rmSync(OLD, { recursive: true, force: true }));
let oldSrc = null;
try { oldSrc = execFileSync("git", ["show", "1abae97:lib/bill-docs/invoice.ts"], { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }); } catch { /* history gone */ }
test("invoice refactor: renderInvoice output is byte-identical to 1abae97's (dates normalized)", { skip: oldSrc ? false : "commit 1abae97 not in this clone" }, async () => {
  mkdirSync(OLD, { recursive: true });
  writeFileSync(join(OLD, "invoice.ts"), oldSrc.replace(/from "@\/([^"]+)"/g, (_, p) => `from ${JSON.stringify(join(ROOT, p) + ".ts")}`));
  const old = await import(pathToFileURL(join(OLD, "invoice.ts")).href);
  const norm = (b) => Buffer.from(Buffer.from(b).toString("latin1").replace(/D:\d{14}Z/g, "D:00000000000000Z"), "latin1");
  const line = (i, o = {}) => ({ kind: "charge", linedate: "2026-06-03", description: `Invented review item ${i} — naïve café`, personid: null, hours: null, rate: null, amount: 1000 + i, ...o });
  const data = (lines) => ({
    bill: { billid: 7, billcaseid: CASE, billdate: "2026-07-01", billtype: "retainer", billhours: 0, billbalance: "99.50", billfinalizedat: "2026-07-01T10:00:00Z", billfilename: `Bill${CASE} Quillon 2026 07 01-0`, billpdfpath: null },
    casetitle: "Example v. Nobody", casecaption: "Court of Samples No. Q-7", address: ["Atty. Pat Quillon", "2 Example Lane", "Faketown ZZ 00002"], attyLastName: "Quillon", lines,
  });
  const cases = [
    [data([line(1), line(2)]), CFG],
    [data(Array.from({ length: 70 }, (_, i) => line(i))), { letterhead: ["Invented Co.", "a", "b", "c"], taxId: "00-1" }],
    [data([line(3)]), {}],
    [data([line(4)]), { letterhead: ["Only Firm Line"] }],
  ];
  for (const [d, cfg] of cases) {
    const a = norm(await renderInvoice(d, cfg)), b = norm(await old.renderInvoice(d, cfg));
    assert.ok(a.equals(b), `invoice bytes differ (${a.length} vs ${b.length}) for cfg ${JSON.stringify(cfg)}`);
  }
});
