/**
 * Live check against the Supabase project in .env.local, driving the same saveCase the
 * server action calls (with the FormData the untouched page submits) and loadCaseRecord
 * the page renders from. Fixture case 90001 is snapshotted first and restored afterwards;
 * bill / service-auth rows this test inserts are removed again. Invented data only.
 * Skips only when .env.local has no Supabase config.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { loadEnvLocal } from "../app-shell/seed-e2e.ts";
import { createServerClient } from "../../lib/db/client.ts";
import { seedFixtures } from "./seed-fixtures.ts";
import { FIELDS, BADGE, formValue, saveCase, loadCaseRecord, attorneyName, clientName } from "../../lib/cases/record.ts";

loadEnvLocal();
const skip = process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY ? false : "no Supabase config in .env.local";
const ID = 90001;
let db, snapshot;
const inserted = { tblbills: [], tblsrvauth: [] };
const PK = { tblbills: "billid", tblsrvauth: "srvauthid" };

const ok = ({ data, error }) => { if (error) throw new Error(error.message); return data; };
const readCase = async () => ok(await db.from("tblcase").select("*").eq("caseid", ID).single());

/** FormData an untouched, unlocked page submits for `row`. */
function formFor(row, overrides = {}) {
  const f = new FormData();
  for (const fl of FIELDS) {
    if (fl.kind === "bool") { f.set(`${fl.col}__present`, "1"); if (row[fl.col] === true) f.set(fl.col, "on"); continue; }
    f.set(fl.col, formValue(fl, row));
  }
  for (const [k, v] of Object.entries(overrides)) f.set(k, v);
  return f;
}

before(async () => {
  if (skip) return;
  db = createServerClient();
  await seedFixtures(db);
  ok(await db.from("tblcasepriority").upsert({ priority: "Low" }, { onConflict: "priority" }));
  snapshot = await readCase();
});

after(async () => {
  if (skip || !snapshot) return;
  for (const [t, ids] of Object.entries(inserted)) if (ids.length) ok(await db.from(t).delete().in(PK[t], ids));
  const { caseid, ...rest } = snapshot;
  ok(await db.from("tblcase").update(rest).eq("caseid", caseid));
});

test("case 90001 loads every fixture value with Pat Example, Example & Partners LLP, Sam Sample", { skip }, async () => {
  const rec = await loadCaseRecord(db, ID);
  for (const [k, v] of Object.entries({ casetitle: "Sample v. Example", tabranch: "Hartford", status: "Active", casestartdate: "2026-01-10", casestatpriority: "High", casestatwaitingfor: "Retainer", caseinquiry: 1, billingalert: false }))
    assert.equal(rec.kase[k], v, k);
  assert.match(attorneyName(rec.atty), /^Pat Example/);
  assert.equal(rec.firm.frmname, "Example & Partners LLP");
  assert.equal(clientName(rec.client), "Sam Sample");
});

test("unchanged save writes nothing; priority change stamps now; notes-only change does not", { skip }, async () => {
  const cur = await readCase();
  const auditSince = async (sinceId) => ok(await db.from("audit_log").select("id, olddata, newdata").eq("tablename", "tblcase").eq("rowid", String(ID)).gt("id", sinceId));
  const last = ok(await db.from("audit_log").select("id").order("id", { ascending: false }).limit(1));
  const since = last[0]?.id ?? 0;

  assert.deepEqual(await saveCase(db, ID, formFor(cur), new Date()), {}, "no columns written");
  assert.deepEqual(await readCase(), cur, "tblcase row unchanged");
  // Another item may touch 90001 concurrently; a no-op write from us would show olddata = newdata.
  const noop = (await auditSince(since)).filter((r) => JSON.stringify(r.olddata) === JSON.stringify(r.newdata));
  assert.equal(noop.length, 0, "no audit_log row from an unchanged save");

  const t0 = Date.now();
  const w = await saveCase(db, ID, formFor(cur, { casestatpriority: cur.casestatpriority === "Low" ? "High" : "Low" }), new Date());
  assert.deepEqual(Object.keys(w).sort(), ["casestatlastupdated", "casestatpriority"]);
  const afterPriority = await readCase();
  assert.equal(afterPriority.casestatpriority, w.casestatpriority);
  assert.ok(Math.abs(Date.parse(afterPriority.casestatlastupdated) - t0) < 60_000, "casestatlastupdated is now");

  await saveCase(db, ID, formFor(afterPriority, { casenotes: `live note ${t0}` }), new Date(t0 + 3_600_000));
  const afterNotes = await readCase();
  assert.equal(afterNotes.casenotes, `live note ${t0}`);
  assert.equal(afterNotes.casestatlastupdated, afterPriority.casestatlastupdated, "notes-only leaves casestatlastupdated");
  assert.equal(afterNotes.numunpaidbills, snapshot.numunpaidbills, "numunpaidbills untouched");
  assert.equal(afterNotes.numunapprovedsa, snapshot.numunapprovedsa, "numunapprovedsa untouched");
});

test("badges follow live rows: bill notice '1st' and service auth 'Declined'", { skip }, async () => {
  const base = (await loadCaseRecord(db, ID)).badges;
  assert.ok(!base.includes(BADGE.unpaid) && !base.includes(BADGE.unapproved), "fixture bill 'First' / SA 'Approved' raise no badge");
  const bill = ok(await db.from("tblbills").insert({ billcaseid: ID, billdate: "2026-03-01", billhours: 1, billbalance: 10, billnotice: "1st" }).select("billid").single());
  inserted.tblbills.push(bill.billid);
  assert.ok((await loadCaseRecord(db, ID)).badges.includes(BADGE.unpaid));
  const sa = ok(await db.from("tblsrvauth").insert({ srvauthcaseid: ID, srvauthdate: "2026-03-01", srvauthhours: 1, srvauthstatus: "Declined" }).select("srvauthid").single());
  inserted.tblsrvauth.push(sa.srvauthid);
  assert.ok((await loadCaseRecord(db, ID)).badges.includes(BADGE.unapproved));
  ok(await db.from("tblcase").update({ numscannedfeeschedule: 0 }).eq("caseid", ID));
  assert.ok((await loadCaseRecord(db, ID)).badges.includes(BADGE.feeSchedule));
});
