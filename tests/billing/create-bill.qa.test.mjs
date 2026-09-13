// QA (item 3): runCreateBill with the real requireSession against a stateful fake PostgREST that applies eq/in/is.
// `hook(table, q, tables)` runs just before a statement executes, so a test can play a concurrent writer. Literals only.
import { test } from "node:test";
import assert from "node:assert/strict";

const { runCreateBill } = await import("../../lib/bills/create.ts");
const { requireSession } = await import("../../lib/auth/session.ts");
const { unbilledHours, listCaseTime } = await import("../../lib/time/case.ts");

function fakeDb(tables, hook = () => {}) {
  const calls = [];
  let nextBill = 880000;
  const db = {
    calls, tables,
    inserts: (t) => calls.filter((c) => c[0] === t && c[1] === "insert").length,
    from(table) {
      const q = { filters: [], update: null, insert: null, del: false, single: false };
      const b = new Proxy({}, {
        get(_, k) {
          if (k === "then") {
            hook(table, q, tables);
            const all = (tables[table] ??= []);
            let rows;
            if (q.insert) { const row = { billid: nextBill++, ...q.insert }; all.push(row); rows = [row]; }
            else {
              rows = all.filter((r) => q.filters.every((f) => f(r)));
              if (q.update) for (const r of rows) Object.assign(r, q.update);
              if (q.del) tables[table] = all.filter((r) => !rows.includes(r));
            }
            const data = q.single ? rows[0] ?? null : rows.map((r) => ({ ...r }));
            return (res, rej) => Promise.resolve({ data, error: null }).then(res, rej);
          }
          return (...a) => {
            calls.push([table, k, ...a]);
            if (k === "eq") q.filters.push((r) => r[a[0]] === a[1]);
            if (k === "in") q.filters.push((r) => a[1].includes(r[a[0]]));
            if (k === "is") q.filters.push((r) => r[a[0]] === a[1]);
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
  return db;
}

const CASE = 991100;
const act = (actid, acthrs, o = {}) => ({ actid, actcaseid: CASE, actdate: "2026-09-02", actdescription: `QA ${actid}`, acthrs, actwho: 1, actbilled: false, actbillid: null, ...o });
const OLD_BILL = { billid: 555, billcaseid: 7, billdate: "2020-01-01" };
const world = (activity, hook, bills = []) => fakeDb({
  tblcase: [{ caseid: CASE, casetitle: "QA v. Fake", caseatty: 31 }, { caseid: 7, casetitle: "Other", caseatty: 31 }],
  tblattorney: [{ attyid: 31, attylastname: "Marlowe" }],
  tblbills: [OLD_BILL, ...bills],
  tblactivity: activity,
  tblbillingnames: [{ personid: 1, initials: "QA" }],
}, hook);
const sessionClient = (role) => ({
  auth: { getUser: async () => ({ data: { user: { id: "u1", email: "q@example.test" } } }) },
  from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { role, personid: 1 } }) }) }) }),
});
const form = (o, actids = []) => {
  const f = new FormData();
  for (const [k, v] of Object.entries({ caseid: String(CASE), billtype: "timesheet", billdate: "2026-09-12", billbalance: "450.00", billnotice: "1st", ...o })) f.set(k, v);
  for (const id of actids) f.append("actid", String(id));
  return f;
};
async function post(db, f, role = "admin") {
  const redirects = [];
  await assert.rejects(runCreateBill(f, {
    session: () => requireSession("admin", sessionClient(role)),
    db: () => db,
    revalidatePath: () => {},
    redirect: (u) => { redirects.push(u); throw Object.assign(new Error("NEXT_REDIRECT"), { url: u }); },
  }), /NEXT_REDIRECT/);
  return redirects;
}
const newBills = (db) => db.tables.tblbills.filter((b) => b.billid >= 880000);
const find = (db, id) => db.tables.tblactivity.find((r) => r.actid === id);

test("done-when 1: timesheet 1.500 + 0.500, balance 450.00 → bill hours 2.000 / 1st / 'Bill991100 Marlowe 2026 09 12-0', both rows claimed, unbilled 0.000", async () => {
  const db = world([act(11, "1.500"), act(12, "0.500")]);
  assert.deepEqual(await post(db, form({}, [11, 12])), ["/bills/880000"]);
  const b = newBills(db);
  assert.equal(b.length, 1);
  assert.equal(b[0].billhours, "2.000");
  assert.equal(b[0].billnotice, "1st");
  assert.equal(b[0].billfilename, "Bill991100 Marlowe 2026 09 12-0");
  assert.equal(b[0].billtype, "timesheet");
  assert.deepEqual([find(db, 11), find(db, 12)].map((r) => [r.actbilled, r.actbillid]), [[true, 880000], [true, 880000]]);
  assert.equal(unbilledHours(await listCaseTime(db, CASE)), "0.000");
});

test("done-when 2: retainer with nothing checked → billhours 0 and no tblactivity statement at all", async () => {
  const db = world([act(11, "1.500"), act(12, "0.500")]);
  assert.deepEqual(await post(db, form({ billtype: "retainer" })), ["/bills/880000"]);
  assert.equal(Number(newBills(db)[0].billhours), 0);
  assert.equal(db.calls.filter((c) => c[0] === "tblactivity").length, 0);
  assert.deepEqual(db.tables.tblactivity, [act(11, "1.500"), act(12, "0.500")]);
});

test("stale (i) pre-check: row billed before the save → error=stale, zero tblbills inserts, other row unbilled", async () => {
  const db = world([act(11, "1.500"), act(12, "0.500", { actbilled: true, actbillid: 555 })]);
  assert.deepEqual(await post(db, form({}, [11, 12])), [`/bills/new?case=${CASE}&error=stale`]);
  assert.equal(db.inserts("tblbills"), 0);
  assert.deepEqual(db.tables.tblbills, [OLD_BILL]);
  assert.deepEqual(find(db, 11), act(11, "1.500"));
  assert.deepEqual(find(db, 12), act(12, "0.500", { actbilled: true, actbillid: 555 }));
});

// Flip a row at the exact moment the claim update executes (after the pre-check read).
const raceTo = (id, patch) => (table, q, t) => {
  if (table === "tblactivity" && q.update?.actbilled === true) Object.assign(t.tblactivity.find((r) => r.actid === id), patch);
};

test("stale (ii) race: row billed to bill 555 between pre-check and claim → error=stale, no new bill, other row actbilled=false actbillid null, 555 kept", async () => {
  const db = world([act(11, "1.500"), act(12, "0.500")], raceTo(12, { actbilled: true, actbillid: 555 }));
  assert.deepEqual(await post(db, form({}, [11, 12])), [`/bills/new?case=${CASE}&error=stale`]);
  assert.deepEqual(db.tables.tblbills, [OLD_BILL]);
  assert.deepEqual([find(db, 11).actbilled, find(db, 11).actbillid], [false, null]);
  assert.deepEqual([find(db, 12).actbilled, find(db, 12).actbillid], [true, 555]);
});

test("race guard actbilled=false: row turned legacy-billed (actbilled=true, actbillid null) mid-save is not re-pointed", async () => {
  const db = world([act(11, "1.500"), act(12, "0.500")], raceTo(12, { actbilled: true }));
  assert.deepEqual(await post(db, form({}, [11, 12])), [`/bills/new?case=${CASE}&error=stale`]);
  assert.deepEqual(db.tables.tblbills, [OLD_BILL]);
  assert.deepEqual([find(db, 12).actbilled, find(db, 12).actbillid], [true, null]);
  assert.deepEqual([find(db, 11).actbilled, find(db, 11).actbillid], [false, null]);
});

test("race guard actbillid is null: row with actbilled=false but actbillid 555 mid-save keeps 555 (fake-only; DB check forbids this pair)", async () => {
  const db = world([act(11, "1.500"), act(12, "0.500")], raceTo(12, { actbillid: 555 }));
  assert.deepEqual(await post(db, form({}, [11, 12])), [`/bills/new?case=${CASE}&error=stale`]);
  assert.deepEqual(db.tables.tblbills, [OLD_BILL]);
  assert.equal(find(db, 12).actbillid, 555);
});

test("only checked rows are updated: unchecked unbilled row on the same case stays unbilled", async () => {
  const db = world([act(11, "1.500"), act(12, "0.500"), act(13, "3.000")]);
  await post(db, form({}, [11, 12]));
  assert.deepEqual(find(db, 13), act(13, "3.000"));
  assert.equal(unbilledHours(await listCaseTime(db, CASE)), "3.000");
});

test("forged hours/total/billhours form fields are ignored: billhours = checked rows' sum 1.500", async () => {
  const db = world([act(11, "1.500")]);
  await post(db, form({ billhours: "99.000", hours: "99", total: "99", unbilled: "99" }, [11]));
  assert.equal(newBills(db)[0].billhours, "1.500");
});

test("filename n: same case other date + other case same date → -0", async () => {
  const db = world([], undefined, [{ billid: 600, billcaseid: CASE, billdate: "2026-09-11" }, { billid: 601, billcaseid: 7, billdate: "2026-09-12" }]);
  await post(db, form({ billtype: "retainer" }));
  assert.equal(newBills(db).at(-1).billfilename, "Bill991100 Marlowe 2026 09 12-0");
});

test("filename n: plus one same-day same-case bill → -1", async () => {
  const db = world([], undefined, [{ billid: 600, billcaseid: CASE, billdate: "2026-09-11" }, { billid: 601, billcaseid: 7, billdate: "2026-09-12" }, { billid: 602, billcaseid: CASE, billdate: "2026-09-12" }]);
  await post(db, form({ billtype: "retainer" }));
  assert.equal(newBills(db).at(-1).billfilename, "Bill991100 Marlowe 2026 09 12-1");
});

test("staff POST refused: error=forbidden and tblbills inserts = 0", async () => {
  const db = world([act(11, "1.500")]);
  assert.deepEqual(await post(db, form({}, [11]), "staff"), [`/bills/new?case=${CASE}&error=forbidden`]);
  assert.equal(db.inserts("tblbills"), 0);
  assert.deepEqual(find(db, 11), act(11, "1.500"));
});
