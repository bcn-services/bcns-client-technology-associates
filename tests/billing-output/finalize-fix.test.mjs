// Item 3 review fixes: the revised/closed-bill guard (server + page + button), the lost-claim-reply release, the
// "finalized with missing lines" detector + Revise recovery, the edit lock inside the update filter, and the
// column caps checked before the claim. Real action bodies over a stateful fake PostgREST; synthetic fixtures only.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

globalThis.React = React;
createRequire(import.meta.url)("react-dom").useFormStatus = () => ({ pending: false });
const { runFinalize, loadFinalize, brokenFinalize } = await import("../../lib/bills/finalize.ts");
const { finalLines, finalizeErrorMessage, initialValues } = await import("../../lib/bills/finalize-model.ts");
const { canFinalizeBill } = await import("../../lib/bills/rules.ts");
const { runRevise } = await import("../../lib/bills/revise.ts");
const { requireSession } = await import("../../lib/auth/session.ts");
const { updateBill } = await import("../../lib/bills/edit.ts");
const { BillView } = await import("../../app/bills/[id]/bill-view.tsx");

const ID_COL = { tblbills: "billid", tblbilllines: "lineid", tblactivity: "actid" };
function fakeDb(tables, hook = () => {}) {
  const calls = [];
  let nextId = 5000;
  return {
    calls, tables,
    from(table) {
      const q = { filters: [], orders: [], update: null, insert: null, del: false, single: false, range: null, limit: null };
      const b = new Proxy({}, {
        get(_, k) {
          if (k === "then") {
            const err = hook(table, q, tables);
            if (err) return (res) => Promise.resolve({ data: null, error: { message: err } }).then(res);
            const all = (tables[table] ??= []);
            let rows;
            if (q.insert) {
              rows = [q.insert].flat().map((r) => ({ [ID_COL[table] ?? "id"]: nextId++, ...r }));
              all.push(...rows);
            } else {
              rows = all.filter((r) => q.filters.every((f) => f(r)));
              if (q.update) for (const r of rows) Object.assign(r, q.update);
              if (q.del) tables[table] = all.filter((r) => !rows.includes(r));
              for (const [col, asc] of [...q.orders].reverse()) rows = [...rows].sort((x, y) => (x[col] < y[col] ? -1 : x[col] > y[col] ? 1 : 0) * (asc ? 1 : -1));
              if (q.range) rows = rows.slice(q.range[0], q.range[1] + 1);
              if (q.limit !== null) rows = rows.slice(0, q.limit);
            }
            const data = q.single ? (rows[0] ? { ...rows[0] } : null) : rows.map((r) => ({ ...r }));
            return (res, rej) => Promise.resolve({ data, error: null }).then(res, rej);
          }
          return (...a) => {
            calls.push([table, k, ...a]);
            const is = (r) => (r[a[0]] ?? null) === a[1];
            if (k === "eq") q.filters.push((r) => r[a[0]] === a[1]);
            if (k === "is") q.filters.push(is);
            if (k === "filter") {
              if (a[1] !== "is" || a[2] !== null) throw new Error(`fake db: filter ${a[1]} ${a[2]}`);
              q.filters.push((r) => (r[a[0]] ?? null) === null);
            }
            if (k === "in") q.filters.push((r) => a[1].includes(r[a[0]]));
            if (k === "order") q.orders.push([a[0], a[1]?.ascending !== false]);
            if (k === "range") q.range = a;
            if (k === "limit") q.limit = a[0];
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

const CASE = 992310;
const B = 810;
const bill = (o = {}) => ({
  billid: B, billcaseid: CASE, billdate: "2026-09-01", billhours: 0, billbalance: 0, billnotice: "1st", billtype: "timesheet",
  billfinalizedat: null, supersedesbillid: null, billreports: null, billfilename: null, billpaiddate: null, billestimate: false,
  billpriority: null, billcomments: null, billsecondnoticedate: null, billfinalnoticedate: null, ...o,
});
const act = (actid, actdate, acthrs, actwho, actbillid = B) => ({ actid, actcaseid: CASE, actdate, actdescription: `Work ${actid}`, acthrs, actwho, actbilled: true, actbillid });
const world = (o = {}, hook) => fakeDb({
  tblbills: [bill(o.bill), ...(o.bills ?? [])],
  tblcase: [{ caseid: CASE, casetitle: "Invented v. Fixture", casestartdate: "2026-01-10", billingalert: false, billingcc: null, caseatty: null }],
  tblactivity: o.activity ?? [act(31, "2026-08-10", "2.000", 1), act(32, "2026-08-11", "1.500", 2)],
  tblbillingnames: [{ personid: 1, initials: "KJS", billingfactor: "1.000" }, { personid: 2, initials: "JON", billingfactor: "0.750" }],
  tblfundsrcvd: [],
  tblbilllines: o.lines ?? [],
}, hook);
const sessionClient = (role) => ({
  auth: { getUser: async () => ({ data: { user: { id: "u1", email: "q@example.test" } } }) },
  from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { role, personid: null } }) }) }) }),
});
const NOW = new Date("2026-09-28T16:00:00Z");
const deps = (db, urls) => ({
  session: () => requireSession("admin", sessionClient("admin")),
  db: () => db,
  now: () => NOW,
  revalidatePath: () => {},
  redirect: (u) => { urls.push(u); throw new Error("NEXT_REDIRECT"); },
});
async function post(db, fields, { id = B, fingerprint } = {}) {
  const f = new FormData();
  f.set("fingerprint", fingerprint ?? (await loadFinalize(db, id)).fingerprint);
  for (const [k, v] of Object.entries(fields)) f.set(k, v);
  const urls = [];
  await assert.rejects(runFinalize(id, f, deps(db, urls)), /NEXT_REDIRECT/);
  return urls[0];
}
const quiet = async (fn) => { const e = console.error; console.error = () => {}; try { return await fn(); } finally { console.error = e; } };
const getB = (db, id = B) => db.tables.tblbills.find((b) => b.billid === id);
const lines = (db, id = B) => db.tables.tblbilllines.filter((l) => l.billid === id);
const writes = (db) => db.calls.filter(([, k]) => k === "update" || k === "insert" || k === "delete");
const FORM = { "rate.1": "399.00", "rate.2": "326.25" };
const view = (o, revisedBy = [], broken = false) => renderToStaticMarkup(React.createElement(BillView, {
  data: { bill: bill(o), casetitle: "Invented v. Fixture", billingalert: false, billingcc: null, activity: [], revisedBy }, admin: true, action: () => {}, broken,
}));

// ---- 1. revised / closed bills ----

test("revised bill (a row supersedes it): not priced, the save refuses with ?error=revised and writes nothing", async () => {
  const db = world({ bills: [bill({ billid: 811, supersedesbillid: B })] });
  const d = await loadFinalize(db, B);
  assert.equal(d.base, null);
  assert.equal(d.revised, true);
  db.calls.length = 0;
  assert.equal(await post(db, FORM, { fingerprint: d.fingerprint }), `/bills/${B}/finalize?error=revised`);
  assert.deepEqual(writes(db), []);
  assert.deepEqual([getB(db).billfinalizedat, getB(db).billbalance, lines(db).length], [null, 0, 0]);
  assert.match(finalizeErrorMessage("revised"), /revised or closed/);
});

test("closed bill (Cancelled / Settled / Carried Over, no revision): refused with ?error=revised; Credit/Refund starts stay finalizable", async () => {
  for (const notice of ["Cancelled", "Settled", "Carried Over"]) {
    const db = world({ bill: { billnotice: notice } });
    assert.equal((await loadFinalize(db, B)).base, null, notice);
    assert.equal(await post(db, FORM), `/bills/${B}/finalize?error=revised`, notice);
    assert.equal(getB(db).billfinalizedat, null, notice);
  }
  for (const notice of ["1st", "2nd", "Final", "Partial Payment", "Deadbeat", "Credit", "Refund"]) {
    assert.equal(canFinalizeBill(bill({ billnotice: notice }), false), true, notice);
  }
});

test("race: Revise lands after the page rendered → the submit is refused, the Cancelled bill is untouched", async () => {
  const db = world();
  const fp = (await loadFinalize(db, B)).fingerprint;
  db.tables.tblbills.push(bill({ billid: 811, supersedesbillid: B }));
  getB(db).billnotice = "Cancelled";
  assert.equal(await post(db, FORM, { fingerprint: fp }), `/bills/${B}/finalize?error=revised`);
  assert.deepEqual([getB(db).billfinalizedat, getB(db).billbalance, lines(db).length], [null, 0, 0]);
});

test("race: the notice changes between the save's read and its claim → the claim (guarded on billnotice) changes 0 rows → stale", async () => {
  const db = world({}, (table, q, t) => {
    if (table === "tblbills" && q.update?.billfinalizedat) t.tblbills[0].billnotice = "Cancelled";
  });
  assert.equal(await post(db, FORM), `/bills/${B}/finalize?error=stale`);
  assert.deepEqual([getB(db).billfinalizedat, getB(db).billbalance, lines(db).length], [null, 0, 0]);
});

test("fingerprint covers the notice: advanced 1st → 2nd after render → stale", async () => {
  const db = world();
  const fp = (await loadFinalize(db, B)).fingerprint;
  getB(db).billnotice = "2nd";
  assert.equal(await post(db, FORM, { fingerprint: fp }), `/bills/${B}/finalize?error=stale`);
  assert.equal(getB(db).billfinalizedat, null);
});

test("bill page: no Finalize button on a revised or closed bill (same predicate as the server)", () => {
  assert.match(view({}), /data-testid="bill-finalize"/);
  assert.doesNotMatch(view({}, [811]), /bill-finalize/);
  assert.doesNotMatch(view({ billnotice: "Cancelled" }), /bill-finalize/);
  assert.match(view({ billnotice: "Credit" }), /data-testid="bill-finalize"/);
});

// ---- 2. lost claim reply, broken-finalize detection, Revise recovery ----

test("claim commits but its reply is an error → released on our stamp: bill un-finalized with its old hours/balance, ?error=failed", async () => {
  const db = world({ bill: { billhours: 1.25, billbalance: 42.5 } }, (table, q, t) => {
    if (table === "tblbills" && q.update?.billfinalizedat) {
      for (const r of t.tblbills.filter((r) => q.filters.every((f) => f(r)))) Object.assign(r, q.update);
      return "connection reset (reply lost)";
    }
  });
  assert.equal(await quiet(() => post(db, FORM)), `/bills/${B}/finalize?error=failed`);
  const b = getB(db);
  assert.deepEqual([b.billfinalizedat, b.billhours, b.billbalance, lines(db).length], [null, 1.25, 42.5, 0]);
  assert.equal((await loadFinalize(db, B)).broken, false);
});

test("claim errors without committing → the release is a no-op (guarded on our stamp)", async () => {
  const db = world({ bill: { billhours: 1.25, billbalance: 42.5 } }, (table, q) => {
    if (table === "tblbills" && q.update?.billfinalizedat) return "timeout";
  });
  assert.equal(await quiet(() => post(db, FORM)), `/bills/${B}/finalize?error=failed`);
  assert.deepEqual([getB(db).billfinalizedat, getB(db).billhours, getB(db).billbalance], [null, 1.25, 42.5]);
});

test("brokenFinalize: finalized with a balance but no lines → broken; a legitimate 0-line $0 finalize and a normal one → not", async () => {
  const stamp = "2026-09-28T16:00:00.000Z";
  assert.equal(brokenFinalize(bill({ billfinalizedat: stamp, billbalance: "1287.00", billhours: "3.50" }), []), true);
  assert.equal(brokenFinalize(bill({ billfinalizedat: stamp, billbalance: "0.00", billhours: "3.50" }), []), true, "hours alone");
  assert.equal(brokenFinalize(bill({ billbalance: "1287.00" }), []), false, "not finalized");
  assert.equal(brokenFinalize(bill({ billtype: null, billfinalizedat: stamp, billbalance: "5.00" }), []), false, "legacy");

  const blank = world({ bill: { billtype: "blank" }, activity: [] });
  assert.equal(await post(blank, {}), `/bills/${B}?saved=1`);
  assert.deepEqual([lines(blank).length, getB(blank).billbalance], [0, "0.00"]);
  assert.equal((await loadFinalize(blank, B)).broken, false, "0-line $0 finalize");

  const ts = world();
  assert.equal(await post(ts, FORM), `/bills/${B}?saved=1`);
  assert.equal((await loadFinalize(ts, B)).broken, false, "normal finalize");
});

test("broken bill: page flags it; Revise rebuilds it — B′ prices from defaults, finalizes cleanly, B is Cancelled and no longer flagged", async () => {
  const db = world({ bill: { billfinalizedat: "2026-09-28T15:00:00.000Z", billhours: "3.50", billbalance: "1287.00" } });
  const d = await loadFinalize(db, B);
  assert.deepEqual([d.broken, d.revised, d.base], [true, false, null]);
  assert.match(view({ billfinalizedat: "2026-09-28T15:00:00.000Z" }, [], true), /data-testid="bill-broken"[^>]*>Lines missing: use Revise to rebuild this bill</);
  assert.match(view({ billfinalizedat: "2026-09-28T15:00:00.000Z" }, [], false), /^(?![\s\S]*bill-broken)/);

  const urls = [];
  const f = new FormData();
  f.set("expected", "1st");
  await assert.rejects(runRevise(B, f, deps(db, urls)), /NEXT_REDIRECT/);
  const B2 = db.tables.tblbills.find((b) => b.supersedesbillid === B).billid;
  assert.deepEqual(urls, [`/bills/${B2}`]);
  assert.equal(getB(db).billnotice, "Cancelled");

  const d2 = await loadFinalize(db, B2);
  assert.deepEqual(initialValues(d2.base, new Map(d2.prior)), { "rate.1": "435.00", "rate.2": "326.25" });
  assert.equal(await post(db, FORM, { id: B2 }), `/bills/${B2}?saved=1`);
  assert.equal((await loadFinalize(db, B2)).broken, false);
  assert.deepEqual([getB(db, B2).billbalance, lines(db, B2).length], ["1287.00", 4]);
  const again = await loadFinalize(db, B);
  assert.deepEqual([again.broken, again.revised], [true, true], "still broken data, but revised → the page stops telling you to Revise");
  assert.doesNotMatch(view({ billfinalizedat: "2026-09-28T15:00:00.000Z", billnotice: "Cancelled" }, [B2], true), /bill-broken/);
});

// ---- 3. edit lock inside the update, caps before the claim ----

test("edit race: a finalize lands between the edit's lock read and its update → 0 rows → locked; billbalance untouched", async () => {
  const db = world({}, (table, q, t) => {
    if (table === "tblbills" && q.update && "billdate" in q.update) Object.assign(t.tblbills[0], { billfinalizedat: "2026-09-28T16:00:00.000Z", billbalance: "1287.00" });
  });
  await assert.rejects(updateBill(db, B, {
    billdate: "2026-09-01", billtype: "timesheet", billbalance: "1.00", billestimate: false, billcomments: null, billfilename: null,
  }), (e) => e.code === "locked");
  assert.equal(getB(db).billbalance, "1287.00");
  await assert.rejects(updateBill(world({ bill: { billid: 1 } }), B, {
    billdate: "2026-09-01", billtype: null, billbalance: "1.00", billestimate: false, billcomments: null, billfilename: null,
  }), (e) => e.code === "notfound");
});

test("caps: rate 99,999,999.99 fits, 100,000,000.00 → too-large before any write; group hours / bill hours past numeric(9,3) → too-large", async () => {
  const ts = { billType: "timesheet", input: { billType: "timesheet", billDate: "2026-09-01", caseStartDate: "2026-01-10",
    activity: [{ date: "2026-08-10", description: "w", hours: 1, personid: 1 }], factors: { 1: 1000 }, funds: [] }, model: { groups: [], flats: [] } };
  assert.equal(finalLines(ts, () => "99999999.99").at(-1).rate, 9_999_999_999);
  assert.throws(() => finalLines(ts, () => "100000000.00"), (e) => e.code === "too-large");
  assert.equal(finalizeErrorMessage("too-large"), "A rate or total is too large.");

  const db = world();
  db.calls.length = 0;
  const fp = (await loadFinalize(db, B)).fingerprint;
  db.calls.length = 0;
  assert.equal(await post(db, { "rate.1": "100000000.00", "rate.2": "326.25" }, { fingerprint: fp }), `/bills/${B}/finalize?error=too-large`);
  assert.deepEqual(writes(db), [], "refused before the claim");

  const depo = { billType: "depo", input: {}, model: { groups: [{ rate: 100, items: [] }], flats: [] } };
  const two = { "g.0.rate": "1.00", "g.0.n": "2", "g.0.0.desc": "a", "g.0.0.hours": "999999", "g.0.1.desc": "b", "g.0.1.hours": "999999" };
  assert.throws(() => finalLines(depo, (k) => two[k] ?? ""), (e) => e.code === "too-large", "group total 1,999,998 hrs");
  const one = { ...two, "g.0.n": "1" };
  assert.equal(finalLines(depo, (k) => one[k] ?? "").at(-1).hours, 999_999_000, "999,999 hrs fits");
  const twoGroups = { billType: "trial", input: {}, model: { groups: [{ rate: 100, items: [] }, { rate: 100, items: [] }], flats: [] } };
  const split = { "g.0.rate": "1.00", "g.0.n": "1", "g.0.0.desc": "a", "g.0.0.hours": "600000", "g.1.rate": "1.00", "g.1.n": "1", "g.1.0.desc": "b", "g.1.0.hours": "600000" };
  assert.throws(() => finalLines(twoGroups, (k) => split[k] ?? ""), (e) => e.code === "too-large", "bill hours 1,200,000");
});
