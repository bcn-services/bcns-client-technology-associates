/** QA edge checks for lib/cases/service-auths.ts — fake DB, pinned clock, literal expectations. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { SA_FIELDS, saValue, saveServiceAuth, SaInputError } from "../../lib/cases/service-auths.ts";
import { firmToday } from "../../lib/cases/presets.ts";

function fakeDb(rows) {
  const writes = [];
  return {
    writes,
    from(t) {
      const filters = [];
      let op = "select", payload = null;
      const exec = () => {
        if (t === "tblcase") return [{ caseid: 90001 }].filter((r) => filters.every((f) => f(r)));
        if (op === "insert") { writes.push({ op, payload }); return [{ srvauthid: 500, ...payload }]; }
        const hit = rows.filter((r) => filters.every((f) => f(r)));
        if (op === "update") { writes.push({ op, payload }); hit.forEach((r) => Object.assign(r, payload)); return null; }
        return hit.map((r) => ({ ...r }));
      };
      const q = {
        select: () => q,
        insert: (p) => ((op = "insert"), (payload = p), q),
        update: (p) => ((op = "update"), (payload = p), q),
        eq: (c, v) => (filters.push((r) => r[c] === v), q),
        maybeSingle: async () => ({ data: exec()?.[0] ?? null, error: null }),
        single: async () => ({ data: exec()[0], error: null }),
        then: (res, rej) => Promise.resolve({ data: exec(), error: null }).then(res, rej),
      };
      return q;
    },
  };
}
const ROW = { srvauthid: 7, srvauthcaseid: 90001, srvauthdate: "2026-08-01", srvauthhours: 1.235, srvauthfile: "F-1", srvauthstatus: "Awaiting Approval", srvdateapproved: null, srvadvance: null, srvauthnotes: null };
function editForm(row, overrides = {}) {
  const f = new FormData();
  f.set("srvauthid", String(row.srvauthid));
  for (const fl of SA_FIELDS) { f.set(fl.col, saValue(fl, row)); f.set(`${fl.col}__orig`, saValue(fl, row)); }
  for (const [k, v] of Object.entries(overrides)) f.set(k, v);
  return f;
}

test("Hartford today at a UTC day boundary: 2026-09-12T02:00Z stamps 2026-09-11", async () => {
  const today = firmToday(new Date("2026-09-12T02:00:00Z"));
  assert.equal(today, "2026-09-11");
  const db = fakeDb([{ ...ROW }]);
  const w = (await saveServiceAuth(db, 90001, editForm(ROW, { srvauthstatus: "Approved" }), today)).written;
  assert.equal(w.srvdateapproved, "2026-09-11");
});

test("lowercase stored 'approved' → 'Modified and Approved': no stamp over a stored date, stamps an empty one (item 7 legacy rule)", async () => {
  const row = { ...ROW, srvauthstatus: "approved", srvdateapproved: "2026-08-02" };
  const db = fakeDb([{ ...row }]);
  assert.deepEqual((await saveServiceAuth(db, 90001, editForm(row, { srvauthstatus: "Modified and Approved" }), "2026-09-11")).written, { srvauthstatus: "Modified and Approved" });
  const bare = { ...row, srvdateapproved: null };
  assert.deepEqual((await saveServiceAuth(fakeDb([{ ...bare }]), 90001, editForm(bare, { srvauthstatus: "Modified and Approved" }), "2026-09-11")).written, { srvauthstatus: "Modified and Approved", srvdateapproved: "2026-09-11" });
});

test("lowercase 'awaiting approval' → 'approved' stamps (case-insensitive transition)", async () => {
  const row = { ...ROW, srvauthstatus: "awaiting approval" };
  const db = fakeDb([{ ...row }]);
  assert.equal((await saveServiceAuth(db, 90001, editForm(row, { srvauthstatus: "approved" }), "2026-09-11")).written.srvdateapproved, "2026-09-11");
});

test("no stamp when __orig had an approval date (DB cleared since render, field blanked): writes null, not today", async () => {
  const db = fakeDb([{ ...ROW, srvauthstatus: "Declined", srvdateapproved: null }]);
  const shown = { ...ROW, srvauthstatus: "Declined", srvdateapproved: "2026-05-05" };
  const w = (await saveServiceAuth(db, 90001, editForm(shown, { srvauthstatus: "Approved", srvdateapproved: "" }), "2026-09-11")).written;
  assert.deepEqual(w, { srvauthstatus: "Approved", srvdateapproved: null });
});

test("Declined → Approved without advance does not stamp", async () => {
  const row = { ...ROW, srvauthstatus: "Declined" };
  const db = fakeDb([{ ...row }]);
  assert.deepEqual((await saveServiceAuth(db, 90001, editForm(row, { srvauthstatus: "Approved without advance" }), "2026-09-11")).written, { srvauthstatus: "Approved without advance" });
});

test("hours 1.235 round-trips: rendered 1.235, untouched save writes nothing, DB write stays a 3-decimal string", async () => {
  assert.equal(saValue(SA_FIELDS[1], ROW), "1.235");
  const db = fakeDb([{ ...ROW }]);
  assert.deepEqual((await saveServiceAuth(db, 90001, editForm(ROW), "2026-09-11")).written, {});
  assert.equal(db.writes.length, 0);
  assert.deepEqual((await saveServiceAuth(db, 90001, editForm(ROW, { srvauthhours: "1.236" }), "2026-09-11")).written, { srvauthhours: "1.236" });
});

test("hours validation: accepts 0.5 / .5 / 123456.789; rejects 1.2345, 1.23456, NaN, 1234567, ' ' → required", async () => {
  for (const good of ["0.5", ".5", "123456.789", "3"]) {
    const db = fakeDb([{ ...ROW }]);
    await saveServiceAuth(db, 90001, editForm(ROW, { srvauthhours: good }), "2026-09-11");
  }
  for (const bad of ["1.2345", "1.23456", "NaN", "1234567", "1.", "Infinity"]) {
    await assert.rejects(saveServiceAuth(fakeDb([{ ...ROW }]), 90001, editForm(ROW, { srvauthhours: bad }), "2026-09-11"),
      (e) => e instanceof SaInputError && e.code === "hours:srvauthhours", bad);
  }
  await assert.rejects(saveServiceAuth(fakeDb([{ ...ROW }]), 90001, editForm(ROW, { srvauthhours: "  " }), "2026-09-11"), (e) => e.code === "required:srvauthhours");
});

test("an add with bad hours writes nothing", async () => {
  const db = fakeDb([]);
  const f = new FormData();
  for (const fl of SA_FIELDS) f.set(fl.col, "");
  f.set("srvauthdate", "2026-09-01"); f.set("srvauthhours", "1.2345"); f.set("srvauthstatus", "Approved");
  await assert.rejects(saveServiceAuth(db, 90001, f, "2026-09-11"), (e) => e.code === "hours:srvauthhours");
  assert.equal(db.writes.length, 0);
});
