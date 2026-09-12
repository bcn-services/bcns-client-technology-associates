/**
 * Live check against the Supabase project in .env.local, driving the real saveServiceAuth (what
 * the server action calls) and the real list/totals functions. Rows this test adds carry the
 * notes tag below and are removed with the service role at setup (leftovers) and teardown; the
 * app itself has no delete. Invented data only. Skips when .env.local has no Supabase config.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { loadEnvLocal } from "../app-shell/seed-e2e.ts";
import { createServerClient } from "../../lib/db/client.ts";
import { seedFixtures } from "./seed-fixtures.ts";
import { firmToday } from "../../lib/cases/presets.ts";
import { SA_FIELDS, saValue, saveServiceAuth, serviceAuthList, serviceAuthTotals, loadServiceAuths } from "../../lib/cases/service-auths.ts";

loadEnvLocal();
const skip = process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY ? false : "no Supabase config in .env.local";
const ID = 90001;
const TAG = "SA-LIVE-TEST";
let db;

const ok = ({ data, error }) => { if (error) throw new Error(error.message); return data; };
const purge = async () => ok(await db.from("tblsrvauth").delete().like("srvauthnotes", `${TAG}%`));
const readSa = async (id) => ok(await db.from("tblsrvauth").select("*").eq("srvauthid", id).single());

function addForm(vals) {
  const f = new FormData();
  for (const fl of SA_FIELDS) f.set(fl.col, vals[fl.col] ?? "");
  return f;
}
function editForm(row, overrides = {}) {
  const f = new FormData();
  f.set("srvauthid", String(row.srvauthid));
  for (const fl of SA_FIELDS) { f.set(fl.col, saValue(fl, row)); f.set(`${fl.col}__orig`, saValue(fl, row)); }
  for (const [k, v] of Object.entries(overrides)) f.set(k, v);
  return f;
}
const add = async (status, notes, extra = {}) =>
  (await saveServiceAuth(db, ID, addForm({ srvauthdate: "2026-09-01", srvauthhours: "1.125", srvauthstatus: status, srvauthnotes: `${TAG} ${notes}`, ...extra }), firmToday(new Date()))).srvauthid;

before(async () => {
  if (skip) return;
  db = createServerClient();
  await seedFixtures(db);
  await purge();
});
after(async () => { if (!skip && db) await purge(); });

test("add on 90001, move to Approved: srvdateapproved = Hartford today; hours keep 3 decimals", { skip }, async () => {
  const id = await add("Awaiting Approval", "stamp");
  const row = await readSa(id);
  assert.equal(row.srvdateapproved, null);
  assert.equal(Number(row.srvauthhours), 1.125);
  const today = firmToday(new Date());
  await saveServiceAuth(db, ID, editForm(row, { srvauthstatus: "Approved" }), today);
  const after = await readSa(id);
  assert.equal(after.srvauthstatus, "Approved");
  assert.equal(after.srvdateapproved, today);
  assert.ok((await loadServiceAuths(db, ID)).some((r) => r.srvauthid === id));
});

test("a hand-entered approval date survives the save that moves the row to Approved", { skip }, async () => {
  const id = await add("Awaiting Approval", "hand");
  await saveServiceAuth(db, ID, editForm(await readSa(id), { srvauthstatus: "Approved", srvdateapproved: "2026-01-02" }), firmToday(new Date()));
  assert.equal((await readSa(id)).srvdateapproved, "2026-01-02");
});

test("seeded 'awaiting approval', 'Awaiting Approval', 'Modified' all in Unapproved; only the first two in Awaiting only", { skip }, async () => {
  // Seed the lowercase migrated spelling directly: the app's own form only offers the canonical case.
  const lower = ok(await db.from("tblsrvauth").insert({ srvauthcaseid: ID, srvauthdate: "2026-02-01", srvauthhours: 1, srvauthstatus: "awaiting approval", srvauthnotes: `${TAG} lower` }).select("srvauthid").single()).srvauthid;
  const canon = await add("Awaiting Approval", "canon");
  const mod = await add("Modified", "mod");
  const unapproved = (await serviceAuthList(db, "unapproved")).map((r) => r.srvauthid);
  const awaiting = (await serviceAuthList(db, "awaiting")).map((r) => r.srvauthid);
  for (const id of [lower, canon, mod]) assert.ok(unapproved.includes(id), `unapproved has ${id}`);
  assert.ok(awaiting.includes(lower) && awaiting.includes(canon) && !awaiting.includes(mod));
  const row = (await serviceAuthList(db, "unapproved")).find((r) => r.srvauthid === canon);
  assert.equal(row.caseid, ID); assert.equal(row.title, "Sample v. Example"); assert.match(row.attorney, /Example/);
});

test("Recently approved orders by approval date; totals match a hand count", { skip }, async () => {
  for (const d of ["2026-03-05", "2026-03-01", "2026-03-09"]) await add("Approved", `ord ${d}`, { srvdateapproved: d });
  const rows = await serviceAuthList(db, "approved");
  const dates = rows.map((r) => r.approvedDate);
  assert.deepEqual(dates, [...dates].sort((a, b) => (!a ? 1 : 0) - (!b ? 1 : 0) || (a < b ? 1 : a > b ? -1 : 0)), "newest approval first");
  const all = ok(await db.from("tblsrvauth").select("srvauthstatus, srvauthhours"));
  const hand = {};
  for (const r of all) {
    const k = r.srvauthstatus.toLowerCase();
    hand[k] ??= { count: 0, milli: 0 };
    hand[k].count++; hand[k].milli += Math.round(Number(r.srvauthhours) * 1000);
  }
  const got = Object.fromEntries((await serviceAuthTotals(db)).map((t) => [t.status.toLowerCase(), { count: t.count, milli: Math.round(Number(t.hours) * 1000) }]));
  assert.deepEqual(got, hand);
});
