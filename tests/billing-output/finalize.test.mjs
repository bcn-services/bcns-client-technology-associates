// Item 3: Finalize (lib/bills/finalize.ts + finalize-model.ts + the page's form/view) through the real action body
// (runFinalize + real requireSession) over a stateful fake PostgREST. `hook(table, q, tables)` runs just before each
// statement, so a test can play a concurrent writer or fail the line insert. Synthetic fixtures; literals only.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

globalThis.React = React;
createRequire(import.meta.url)("react-dom").useFormStatus = () => ({ pending: false });
const { runFinalize, loadFinalize } = await import("../../lib/bills/finalize.ts");
const { initialValues, finalLines, parseCents, parseThousandths } = await import("../../lib/bills/finalize-model.ts");
const { summarize } = await import("../../lib/bills/lines.ts");
const { requireSession } = await import("../../lib/auth/session.ts");
const { updateBill } = await import("../../lib/bills/edit.ts");
const { parseBillCreate } = await import("../../lib/bills/create.ts");
const { BillView } = await import("../../app/bills/[id]/bill-view.tsx");
const { FinalizeForm } = await import("../../app/bills/[id]/finalize/finalize-form.tsx");
const { LinesTable } = await import("../../app/bills/[id]/finalize/lines-table.tsx");

function fakeDb(tables, hook = () => {}) {
  const calls = [];
  let nextId = 5000;
  return {
    calls, tables,
    from(table) {
      const q = { filters: [], orders: [], update: null, insert: null, del: false, single: false, range: null };
      const b = new Proxy({}, {
        get(_, k) {
          if (k === "then") {
            const err = hook(table, q, tables);
            if (err) return (res) => Promise.resolve({ data: null, error: { message: err } }).then(res);
            const all = (tables[table] ??= []);
            let rows;
            if (q.insert) {
              rows = [q.insert].flat().map((r) => ({ lineid: nextId++, ...r }));
              all.push(...rows);
            } else {
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
            calls.push([table, k, ...a]);
            if (k === "eq") q.filters.push((r) => r[a[0]] === a[1]);
            if (k === "is") q.filters.push((r) => (r[a[0]] ?? null) === a[1]);
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

const CASE = 992300;
const B = 800;
const bill = (o = {}) => ({
  billid: B, billcaseid: CASE, billdate: "2026-09-01", billhours: 0, billbalance: 0, billnotice: "1st", billtype: "timesheet",
  billfinalizedat: null, supersedesbillid: null, billreports: null, billfilename: null, billpaiddate: null, billestimate: false,
  billpriority: null, billcomments: null, billsecondnoticedate: null, billfinalnoticedate: null, ...o,
});
const act = (actid, actdate, acthrs, actwho, actbillid = B) => ({ actid, actcaseid: CASE, actdate, actdescription: `Work ${actid}`, acthrs, actwho, actbilled: true, actbillid });
const world = (o = {}, hook) => fakeDb({
  tblbills: [bill(o.bill)],
  tblcase: [{ caseid: CASE, casetitle: "Invented v. Fixture", casestartdate: "2026-01-10", billingalert: o.alert ?? false, billingcc: null }],
  tblactivity: o.activity ?? [act(21, "2026-08-10", "2.000", 1), act(22, "2026-08-11", "1.500", 2)],
  tblbillingnames: [{ personid: 1, initials: "KJS", billingfactor: "1.000" }, { personid: 2, initials: "JON", billingfactor: "0.750" }],
  tblfundsrcvd: o.funds ?? [],
  tblbilllines: o.lines ?? [],
}, hook);
const sessionClient = (role) => ({
  auth: { getUser: async () => ({ data: { user: { id: "u1", email: "q@example.test" } } }) },
  from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { role, personid: null } }) }) }) }),
});
const NOW = new Date("2026-09-28T16:00:00Z");
async function post(db, fields, { role = "admin", id = B, fingerprint } = {}) {
  const f = new FormData();
  f.set("fingerprint", fingerprint ?? (await loadFinalize(db, id)).fingerprint);
  for (const [k, v] of Object.entries(fields)) f.set(k, v);
  const urls = [];
  await assert.rejects(runFinalize(id, f, {
    session: () => requireSession("admin", sessionClient(role)),
    db: () => db,
    now: () => NOW,
    revalidatePath: () => {},
    redirect: (u) => { urls.push(u); throw new Error("NEXT_REDIRECT"); },
  }), /NEXT_REDIRECT/);
  return urls[0];
}
const getB = (db, id = B) => db.tables.tblbills.find((b) => b.billid === id);
const lines = (db, id = B) => db.tables.tblbilllines.filter((l) => l.billid === id).sort((a, b) => a.lineno - b.lineno);
const text = (html) => html.replace(/<[^>]+>/g, " ").replace(/&[a-z#0-9]+;/g, " ").replace(/\s+/g, " ").trim();

test("done-when 1: KJS rate changed to 399.00 → KJS total line carries 399.00, JON keeps default 326.25; hours/balance/finalizedat saved", async () => {
  const db = world();
  const d = await loadFinalize(db, B);
  assert.deepEqual(initialValues(d.base, new Map(d.prior)), { "rate.1": "435.00", "rate.2": "326.25" });
  assert.equal(await post(db, { "rate.1": "399.00", "rate.2": "326.25" }), `/bills/${B}?saved=1`);
  const totals = lines(db).filter((l) => l.personid !== null).map((l) => [l.personid, l.rate, l.hours, l.amount, l.description]);
  assert.deepEqual(totals, [[1, "399.00", "2.000", "798.00", "2 hrs x $399/hr"], [2, "326.25", "1.500", "489.00", "1.5 hrs x $326.25/hr"]]);
  assert.deepEqual(lines(db).map((l) => l.lineno), [1, 2, 3, 4]);
  const b = getB(db);
  assert.equal(b.billfinalizedat, "2026-09-28T16:00:00.000Z");
  assert.equal(b.billhours, "3.50");
  assert.equal(b.billbalance, "1287.00");
});

test("the total on screen (form preview) equals the total saved", async () => {
  const db = world({ funds: [{ fndsid: 7, fndscaseid: CASE, fndsdate: "2026-08-01", fndstype: "Retainer", fndspmt: "100.00", fndsbillid: null }] });
  const d = await loadFinalize(db, B);
  const initial = { ...initialValues(d.base, new Map()), "rate.1": "399.00" };
  const html = renderToStaticMarkup(React.createElement(FinalizeForm, { base: d.base, initial, initials: d.initials, fingerprint: d.fingerprint, action: () => {} }));
  const shown = /Balance \$([\d,.-]+)/.exec(text(html))[1];
  assert.match(text(html), /Credit: Retainer/);
  assert.equal(await post(db, { "rate.1": "399.00", "rate.2": "326.25" }), `/bills/${B}?saved=1`);
  assert.equal(shown, "1,187.00");
  assert.equal(getB(db).billbalance, "1187.00");
});

test("form: one rate box per person labelled 'Rate for <initials>' with a 'default $X' hint, exactly one Save/Finalize button", async () => {
  const d = await loadFinalize(world(), B);
  const html = renderToStaticMarkup(React.createElement(FinalizeForm, { base: d.base, initial: initialValues(d.base, new Map()), initials: d.initials, fingerprint: d.fingerprint, action: () => {} }));
  assert.match(html, /<label for="fin-rate-1">Rate for KJS<\/label>/);
  assert.match(html, /<label for="fin-rate-2">Rate for JON<\/label>/);
  assert.match(text(html), /default \$435\.00.*default \$326\.25/);
  assert.equal((html.match(/<button[^>]*>[^<]*(save|finalize)/gi) ?? []).length, 1);
});

test("guardrail: staff → ?error=forbidden with no DB call at all", async () => {
  const db = world();
  const fp = (await loadFinalize(db, B)).fingerprint;
  db.calls.length = 0;
  assert.equal(await post(db, { "rate.1": "399.00", "rate.2": "326.25" }, { role: "staff", fingerprint: fp }), `/bills/${B}/finalize?error=forbidden`);
  assert.deepEqual(db.calls, []);
  assert.equal(getB(db).billfinalizedat, null);
});

test("guardrail: double submit → second is stale, 0 rows changed; a finalize landing just before the claim → stale, no lines", async () => {
  const db = world();
  const fp = (await loadFinalize(db, B)).fingerprint;
  const form = { "rate.1": "399.00", "rate.2": "326.25" };
  assert.equal(await post(db, form, { fingerprint: fp }), `/bills/${B}?saved=1`);
  const snap = JSON.stringify([getB(db), lines(db)]);
  assert.equal(await post(db, form, { fingerprint: fp }), `/bills/${B}/finalize?error=stale`);
  assert.equal(JSON.stringify([getB(db), lines(db)]), snap);

  // Race: the other submit's claim lands between our read and our claim.
  const raced = world({}, (table, q, t) => {
    if (table === "tblbills" && q.update?.billfinalizedat) t.tblbills[0].billfinalizedat = "2026-09-28T15:59:59.000Z";
  });
  assert.equal(await post(raced, form), `/bills/${B}/finalize?error=stale`);
  assert.equal(lines(raced).length, 0);
  assert.equal(getB(raced).billbalance, 0);
});

test("guardrail: time rows changed after the page rendered → stale; the admin's own edits are not staleness", async () => {
  const db = world();
  const fp = (await loadFinalize(db, B)).fingerprint;
  db.tables.tblactivity.push(act(23, "2026-08-12", "0.500", 1));
  assert.equal(await post(db, { "rate.1": "399.00", "rate.2": "326.25" }, { fingerprint: fp }), `/bills/${B}/finalize?error=stale`);
  assert.equal(getB(db).billfinalizedat, null);
  const db2 = world();
  const fp2 = (await loadFinalize(db2, B)).fingerprint;
  assert.equal(await post(db2, { "rate.1": "1.00", "rate.2": "2.00" }, { fingerprint: fp2 }), `/bills/${B}?saved=1`);
});

test("guardrail: legacy bill (billtype null) → no Finalize control; the action refuses with ?error=legacy and writes nothing", async () => {
  const db = world({ bill: { billtype: null } });
  assert.equal(await post(db, {}), `/bills/${B}/finalize?error=legacy`);
  assert.ok(!db.calls.some(([, k]) => k === "update" || k === "insert"));
  const view = (o, admin = true, revisedBy = []) => renderToStaticMarkup(React.createElement(BillView, {
    data: { bill: bill(o), casetitle: "Invented v. Fixture", billingalert: false, billingcc: null, activity: [], revisedBy }, admin, action: () => {},
  }));
  assert.doesNotMatch(view({ billtype: null }), /bill-finalize/);
  assert.match(view({}), /data-testid="bill-finalize"[^>]*>Finalize bill</);
  assert.doesNotMatch(view({}, false), /bill-finalize|Finalize bill/);
  assert.doesNotMatch(view({}, true, [801]), /bill-finalize/);
  const fin = view({ billfinalizedat: "2026-09-28T16:00:00.000Z" });
  assert.doesNotMatch(fin, /bill-finalize"|bill-edit/);
  assert.match(text(fin), /Finalized 2026-09-28 — the lines are locked; changes go through Revise/);
});

test("guardrail: the line insert fails → lines deleted, bill un-finalized with its old hours/balance, ?error=failed", async () => {
  const db = world({ bill: { billhours: 1.25, billbalance: 42.5 } }, (table, q, t) => {
    if (table === "tblbilllines" && q.insert) { t.tblbilllines.push({ lineid: 1, billid: B, lineno: 1 }); return "insert failed"; }
  });
  const logged = console.error;
  console.error = () => {};
  try {
    assert.equal(await post(db, { "rate.1": "399.00", "rate.2": "326.25" }), `/bills/${B}/finalize?error=failed`);
  } finally { console.error = logged; }
  const b = getB(db);
  assert.deepEqual([b.billfinalizedat, b.billhours, b.billbalance], [null, 1.25, 42.5]);
  assert.equal(lines(db).length, 0);
});

test("done-when 3: a finalized bill loads its STORED lines (no re-pricing) even when today's defaults would differ; edits are locked", async () => {
  const db = world();
  assert.equal(await post(db, { "rate.1": "399.00", "rate.2": "326.25" }), `/bills/${B}?saved=1`);
  // Defaults move: the case now starts in 2020 (late rate 475) and JON's factor drops — the saved bill must not follow.
  db.tables.tblcase[0].casestartdate = "2020-01-01";
  db.tables.tblbillingnames[1].billingfactor = "0.500";
  const d = await loadFinalize(db, B);
  assert.equal(d.base, null);
  const html = text(renderToStaticMarkup(React.createElement(LinesTable, { lines: d.stored, testid: "t" })));
  assert.match(html, /2 hrs x \$399\/hr \$798\.00 1\.5 hrs x \$326\.25\/hr \$489\.00 Total hours 3\.50 · Balance \$1,287\.00/);
  await assert.rejects(updateBill(db, B, {
    billdate: "2026-09-01", billtype: "timesheet", billbalance: "1.00", billestimate: false, billcomments: null, billfilename: null,
  }), (e) => e.code === "locked");
  assert.equal(getB(db).billbalance, "1287.00");
});

test("revision: Finalize pre-fills from the superseded bill's STORED rates / estimate lines, not the defaults", async () => {
  const stored = (billid, rows) => rows.map(([kind, description, personid, hours, rate, amount], i) =>
    ({ lineid: 900 + i, billid, lineno: i + 1, kind, linedate: null, description, personid, hours, rate, amount }));
  const db = world({
    bill: { billid: 801, supersedesbillid: B },
    activity: [act(21, "2026-08-10", "2.000", 1, 801)],
    lines: stored(B, [["charge", "2 hrs x $250/hr", 1, "2.000", "250.00", "500.00"]]),
  });
  db.tables.tblbills.push(bill({ billfinalizedat: "2026-09-02T12:00:00Z", billnotice: "Cancelled" }));
  const d = await loadFinalize(db, 801);
  assert.deepEqual(initialValues(d.base, new Map(d.prior)), { "rate.1": "250.00" });

  const dep = world({
    bill: { billid: 801, supersedesbillid: B, billtype: "depo" },
    lines: stored(B, [["estimate", "Deposition (via Zoom), Superior Ct", null, "7.000", null, "0.00"], ["estimate", "7 hrs (est.) x $400/hr", null, "7.000", "400.00", "2800.00"]]),
  });
  dep.tables.tblbills.push(bill({ billtype: "depo", billfinalizedat: "2026-09-02T12:00:00Z" }));
  const e = await loadFinalize(dep, 801);
  assert.deepEqual(initialValues(e.base, new Map()), { "g.0.rate": "400.00", "g.0.n": "1", "g.0.0.desc": "Deposition (via Zoom), Superior Ct", "g.0.0.hours": "7" });
});

test("trial estimate: edited description, extra line, edited expense → totals rebuilt through totalLine; bad input is a form error, not a 500", async () => {
  const db = world({ bill: { billtype: "trial" }, activity: [] });
  const d = await loadFinalize(db, B);
  const v = initialValues(d.base, new Map());
  assert.deepEqual([v["g.0.rate"], v["g.1.rate"], v["f.0.amount"]], ["435.00", "490.00", "100.00"]);
  const form = { ...v, "g.0.n": "3", "g.0.2.desc": "Review exhibits", "g.0.2.hours": "1.5", "g.1.0.desc": "Travel & court time (County Courthouse)", "f.0.amount": "85.50" };
  assert.equal(await post(db, { ...form, "g.0.rate": "4.355" }), `/bills/${B}/finalize?error=rate`);
  assert.equal(await post(db, { ...form, "g.0.2.hours": "abc" }), `/bills/${B}/finalize?error=hours`);
  assert.equal(getB(db).billfinalizedat, null);
  assert.equal(await post(db, form), `/bills/${B}?saved=1`);
  assert.deepEqual(lines(db).map((l) => [l.kind, l.description, l.rate, l.amount]), [
    ["estimate", "Review file and prep for trial", null, "0.00"],
    ["estimate", "Telecom w/ atty.", null, "0.00"],
    ["estimate", "Review exhibits", null, "0.00"],
    ["estimate", "9.5 hrs (est.) x $435/hr", "435.00", "4133.00"],
    ["estimate", "Travel & court time (County Courthouse)", null, "0.00"],
    ["estimate", "10 hrs (est.) x $490/hr", "490.00", "4900.00"],
    ["expense", "Expenses: Travel to court & parking", null, "85.50"],
  ]);
  assert.equal(getB(db).billbalance, "9118.50");
  assert.equal(getB(db).billhours, "19.50");
});

test("parsers: integer cents / thousandths only; blank new-bill balance → 0", () => {
  assert.deepEqual(["435", "1,234.5", "$0.07", "4.355", "-1", "1e3"].map(parseCents), [43500, 123450, 7, null, null, null]);
  assert.deepEqual(["2", "0.125", "1.2345", ""].map(parseThousandths), [2000, 125, null, null]);
  const f = new FormData();
  for (const [k, v] of Object.entries({ billtype: "timesheet", billdate: "2026-09-01", billbalance: "" })) f.set(k, v);
  assert.equal(parseBillCreate(f).billbalance, "0");
  f.set("billbalance", "12.345");
  assert.throws(() => parseBillCreate(f), (e) => e.code === "balance");
  assert.equal(summarize(finalLines({ billType: "blank", input: {}, model: { groups: [], flats: [] } }, () => "")).balance, 0);
});
