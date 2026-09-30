/** Unit checks for lib/cases/service-auths.ts — fake DB client, pinned "today", no network. */
import { test } from "node:test";
import assert from "node:assert/strict";
import * as SA from "../../lib/cases/service-auths.ts";

const { SA_FIELDS, saValue, saveServiceAuth, serviceAuthList, serviceAuthTotals, isApproved, isUnapproved, isAwaiting, SaInputError } = SA;
const TODAY = "2026-09-11";

/** In-memory PostgREST slice: select/eq/in/or(ilike)/order/range/maybeSingle/single/insert/update. */
function fakeDb(tables) {
  const writes = [];
  let nextId = 1000;
  return {
    writes,
    from(t) {
      const filters = [];
      let op = "select", payload = null, rng = null;
      const exec = () => {
        const rows = (tables[t] ??= []);
        if (op === "insert") {
          const r = { srvauthid: nextId++, ...payload };
          rows.push(r); writes.push({ table: t, op, payload });
          return { data: [{ ...r }], error: null };
        }
        const hit = rows.filter((r) => filters.every((fn) => fn(r)));
        if (op === "update") { writes.push({ table: t, op, payload }); hit.forEach((r) => Object.assign(r, payload)); return { data: null, error: null }; }
        let out = hit;
        if (rng) out = out.slice(rng[0], rng[1] + 1);
        return { data: out.map((r) => ({ ...r })), error: null };
      };
      const q = {
        select: () => q,
        insert: (p) => ((op = "insert"), (payload = p), q),
        update: (p) => ((op = "update"), (payload = p), q),
        eq: (c, v) => (filters.push((r) => r[c] === v), q),
        in: (c, vs) => (filters.push((r) => vs.includes(r[c])), q),
        or: (s) => {
          const els = [...s.matchAll(/([a-z]+)\.ilike\."([^"]*)"/g)].map((m) => [m[1], m[2].toLowerCase()]);
          assert.equal(els.length, s.split(",").length, `unparsed or(): ${s}`);
          filters.push((r) => els.some(([c, v]) => String(r[c] ?? "").toLowerCase() === v));
          return q;
        },
        order: () => q,
        range: (a, b) => ((rng = [a, b]), q),
        maybeSingle: async () => ({ data: exec().data?.[0] ?? null, error: null }),
        single: async () => ({ data: exec().data[0], error: null }),
        then: (res, rej) => Promise.resolve(exec()).then(res, rej),
      };
      return q;
    },
  };
}

const CASE = { caseid: 90001, casetitle: "Sample v. Example", tabranch: "Hartford", caseatty: 1 };
const base = (sa = []) => ({
  tblcase: [{ ...CASE }, { caseid: 90002, casetitle: "No Atty", tabranch: "NYC", caseatty: null }, { caseid: 90003, casetitle: "Lost Firm", tabranch: "Hartford", caseatty: 2 }],
  tblattorney: [{ attyid: 1, attyfirstname: "Pat", attylastname: "Example", attyfirmid: 1 }, { attyid: 2, attyfirstname: "Lee", attylastname: "Orphan", attyfirmid: 99 }],
  tblfirm: [{ frmid: 1, frmphone: "860-555-0100" }],
  tblsrvauth: sa,
});

/** The FormData the untouched edit form submits for `row`, plus overrides. */
function editForm(row, overrides = {}) {
  const f = new FormData();
  f.set("srvauthid", String(row.srvauthid));
  for (const fl of SA_FIELDS) { f.set(fl.col, saValue(fl, row)); f.set(`${fl.col}__orig`, saValue(fl, row)); }
  for (const [k, v] of Object.entries(overrides)) f.set(k, v);
  return f;
}
function addForm(vals) {
  const f = new FormData();
  for (const fl of SA_FIELDS) f.set(fl.col, vals[fl.col] ?? "");
  return f;
}
const ROW = { srvauthid: 7, srvauthcaseid: 90001, srvauthdate: "2026-08-01", srvauthhours: 12.5, srvauthfile: "F-1", srvauthstatus: "Awaiting Approval", srvdateapproved: null, srvadvance: null, srvauthnotes: "line 1\nline 2" };

test("status list is exactly the legacy value list", () => {
  assert.deepEqual(SA.SA_STATUSES, ["Awaiting Approval", "Approved without advance", "Declined", "Modified", "Modified and Approved", "Approved", "Replaced"]);
});

test("predicates are case-insensitive and exact", () => {
  for (const s of ["awaiting approval", "Awaiting Approval", "AWAITING APPROVAL"]) assert.ok(isUnapproved(s) && isAwaiting(s), s);
  for (const s of ["Modified", "modified"]) assert.ok(isUnapproved(s) && !isAwaiting(s), s);
  for (const s of ["Approved", "approved", "Modified and Approved", "MODIFIED AND APPROVED"]) assert.ok(isApproved(s) && !isUnapproved(s), s);
  for (const s of ["Approved without advance", "Declined", "Replaced", "", null]) assert.ok(!isApproved(s) && !isUnapproved(s) && !isAwaiting(s), String(s));
});

test("adding with Approved stamps today; a hand-entered approval date wins; Awaiting leaves it blank", async () => {
  const db = fakeDb(base());
  const a = await saveServiceAuth(db, 90001, addForm({ srvauthdate: "2026-09-01", srvauthhours: "1.125", srvauthstatus: "Approved" }), TODAY);
  assert.equal(a.written.srvdateapproved, TODAY);
  assert.equal(a.written.srvauthhours, "1.125", "hours sent as the exact string");
  const b = await saveServiceAuth(db, 90001, addForm({ srvauthdate: "2026-09-01", srvauthhours: "2", srvauthstatus: "approved", srvdateapproved: "2026-01-02" }), TODAY);
  assert.equal(b.written.srvdateapproved, "2026-01-02");
  const c = await saveServiceAuth(db, 90001, addForm({ srvauthdate: "2026-09-01", srvauthhours: "2", srvauthstatus: "Awaiting Approval" }), TODAY);
  assert.equal(c.written.srvdateapproved, null);
  assert.equal(c.written.srvauthcaseid, 90001);
});

test("edit: Awaiting → Approved stamps today; untouched save writes nothing", async () => {
  const db = fakeDb(base([{ ...ROW }]));
  assert.deepEqual((await saveServiceAuth(db, 90001, editForm(ROW), TODAY)).written, {});
  assert.equal(db.writes.length, 0);
  const w = (await saveServiceAuth(db, 90001, editForm(ROW, { srvauthstatus: "Approved" }), TODAY)).written;
  assert.deepEqual(w, { srvauthstatus: "Approved", srvdateapproved: TODAY });
});

test("edit: Modified → Modified and Approved stamps; hand-entered date in the same save wins", async () => {
  const row = { ...ROW, srvauthstatus: "Modified" };
  const db = fakeDb(base([{ ...row }]));
  assert.equal((await saveServiceAuth(db, 90001, editForm(row, { srvauthstatus: "Modified and Approved" }), TODAY)).written.srvdateapproved, TODAY);
  const db2 = fakeDb(base([{ ...row }]));
  const w = (await saveServiceAuth(db2, 90001, editForm(row, { srvauthstatus: "Approved", srvdateapproved: "2026-02-03" }), TODAY)).written;
  assert.equal(w.srvdateapproved, "2026-02-03");
});

test("no stamp: date already in DB, or status unchanged; approved → other approved stamps only an empty date (item 7 legacy rule)", async () => {
  const appr = { ...ROW, srvauthstatus: "Approved" };
  const db = fakeDb(base([{ ...appr }]));
  assert.deepEqual((await saveServiceAuth(db, 90001, editForm(appr, { srvauthstatus: "Modified and Approved" }), TODAY)).written, { srvauthstatus: "Modified and Approved", srvdateapproved: TODAY });
  const dated = { ...appr, srvdateapproved: "2026-04-04" };
  const db1 = fakeDb(base([{ ...dated }]));
  assert.deepEqual((await saveServiceAuth(db1, 90001, editForm(dated, { srvauthstatus: "Modified and Approved" }), TODAY)).written, { srvauthstatus: "Modified and Approved" });
  // Form rendered before another user set the date: orig blank, DB has it.
  const db2 = fakeDb(base([{ ...ROW, srvdateapproved: "2026-05-05" }]));
  assert.deepEqual((await saveServiceAuth(db2, 90001, editForm(ROW, { srvauthstatus: "Approved" }), TODAY)).written, { srvauthstatus: "Approved" });
  const db3 = fakeDb(base([{ ...ROW }]));
  assert.deepEqual((await saveServiceAuth(db3, 90001, editForm(ROW, { srvauthnotes: "x" }), TODAY)).written, { srvauthnotes: "x" });
});

test("hours keep 3 decimals; 1.5 vs 12.500 compares by value; >3 decimals and non-numbers are input errors", async () => {
  assert.equal(saValue(SA_FIELDS[1], { srvauthhours: 0.001 }), "0.001");
  const db = fakeDb(base([{ ...ROW }]));
  assert.deepEqual((await saveServiceAuth(db, 90001, editForm(ROW, { srvauthhours: "12.5" }), TODAY)).written, {});
  assert.deepEqual((await saveServiceAuth(db, 90001, editForm(ROW, { srvauthhours: "12.501" }), TODAY)).written, { srvauthhours: "12.501" });
  for (const bad of ["1.2345", "abc", "1e3", "-1", "1,5"])
    await assert.rejects(saveServiceAuth(db, 90001, editForm(ROW, { srvauthhours: bad }), TODAY), (e) => e instanceof SaInputError && e.code === "hours:srvauthhours", bad);
  await assert.rejects(saveServiceAuth(db, 90001, editForm(ROW, { srvauthhours: "" }), TODAY), (e) => e.code === "required:srvauthhours");
  assert.match(SA.saErrorMessage("hours:srvauthhours"), /3 decimals/);
  assert.equal(SA.saErrorMessage("<script>"), "Service authorization not saved; nothing was changed.");
});

test("CRLF notes from a textarea are not a change; __orig missing means not written", async () => {
  const db = fakeDb(base([{ ...ROW }]));
  assert.deepEqual((await saveServiceAuth(db, 90001, editForm(ROW, { srvauthnotes: "line 1\r\nline 2" }), TODAY)).written, {});
  const f = editForm(ROW, { srvauthfile: "F-2" });
  f.delete("srvauthfile__orig");
  assert.deepEqual((await saveServiceAuth(db, 90001, f, TODAY)).written, {});
});

test("status: off-list stored value may stay; changing to an off-list value is refused", async () => {
  const odd = { ...ROW, srvauthstatus: "Pending (old)" };
  const db = fakeDb(base([{ ...odd }]));
  assert.deepEqual((await saveServiceAuth(db, 90001, editForm(odd, { srvauthnotes: "n" }), TODAY)).written, { srvauthnotes: "n" });
  await assert.rejects(saveServiceAuth(db, 90001, editForm(ROW, { srvauthstatus: "Whatever" }), TODAY), (e) => e.code === "status:srvauthstatus");
});

test("a row of another case is not found; so is a missing case on add", async () => {
  const db = fakeDb(base([{ ...ROW }]));
  await assert.rejects(saveServiceAuth(db, 90002, editForm(ROW, { srvauthnotes: "x" }), TODAY), (e) => e.code === "notfound");
  await assert.rejects(saveServiceAuth(db, 123, addForm({ srvauthdate: "2026-09-01", srvauthhours: "1", srvauthstatus: "Approved" }), TODAY), (e) => e.code === "notfound");
  assert.equal(db.writes.length, 0);
});

test("no delete export", () => {
  assert.ok(!Object.keys(SA).some((k) => /delete|remove/i.test(k)));
});

const sa = (srvauthid, srvauthcaseid, srvauthstatus, srvauthdate, srvdateapproved = null, srvauthhours = 1) => ({ srvauthid, srvauthcaseid, srvauthstatus, srvauthdate, srvdateapproved, srvauthhours });
const LIST_ROWS = [
  sa(1, 90001, "awaiting approval", "2026-03-03", null, 1.25),
  sa(2, 90002, "Awaiting Approval", "2026-03-01", null, 2),
  sa(3, 90003, "Modified", "2026-03-02", null, 0.125),
  sa(4, 90001, "Approved", "2026-01-01", "2026-04-02", 3),
  sa(5, 90001, "Modified and Approved", "2026-01-02", "2026-04-09", 1.001),
  sa(6, 90001, "approved", "2026-01-03", "2026-04-05", 1),
  sa(7, 90001, "Declined", "2026-01-04", null, 4),
  sa(8, 90001, "Approved without advance", "2026-01-05", "2026-04-20", 5),
  sa(9, 90404, "Modified", "2026-03-04", null, 1),
];

test("Unapproved has both awaiting spellings and Modified by auth date; Awaiting only the first two", async () => {
  const db = fakeDb(base(LIST_ROWS.map((r) => ({ ...r }))));
  assert.deepEqual((await serviceAuthList(db, "unapproved")).map((r) => r.srvauthid), [2, 3, 1, 9]);
  assert.deepEqual((await serviceAuthList(db, "awaiting")).map((r) => r.srvauthid), [2, 1]);
});

test("row shape: case #, title, branch, attorney, firm phone; missing attorney / firm / case are blank", async () => {
  const rows = await serviceAuthList(fakeDb(base(LIST_ROWS.map((r) => ({ ...r })))), "unapproved");
  const by = Object.fromEntries(rows.map((r) => [r.srvauthid, r]));
  assert.deepEqual(by[1], { srvauthid: 1, caseid: 90001, title: "Sample v. Example", branch: "Hartford", attorney: "Pat Example", firmPhone: "860-555-0100", status: "awaiting approval", hours: "1.250", authDate: "2026-03-03", approvedDate: "" });
  assert.equal(by[2].attorney, ""); assert.equal(by[2].firmPhone, "");
  assert.equal(by[3].attorney, "Lee Orphan"); assert.equal(by[3].firmPhone, "");
  assert.equal(by[9].title, ""); assert.equal(by[9].caseid, 90404);
});

test("Recently approved: Approved + Modified and Approved, newest approval first", async () => {
  const rows = await serviceAuthList(fakeDb(base(LIST_ROWS.map((r) => ({ ...r })))), "approved");
  assert.deepEqual(rows.map((r) => [r.srvauthid, r.approvedDate]), [[5, "2026-04-09"], [6, "2026-04-05"], [4, "2026-04-02"]]);
});

test("totals: count and hours per status, case variants merged, 3 decimals", async () => {
  const t = await serviceAuthTotals(fakeDb(base(LIST_ROWS.map((r) => ({ ...r })))));
  assert.deepEqual(t, [
    { status: "Approved", count: 2, hours: "4.000" },
    { status: "Approved without advance", count: 1, hours: "5.000" },
    { status: "Awaiting Approval", count: 2, hours: "3.250" },
    { status: "Declined", count: 1, hours: "4.000" },
    { status: "Modified", count: 2, hours: "1.125" },
    { status: "Modified and Approved", count: 1, hours: "1.001" },
  ]);
});
