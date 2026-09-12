/**
 * Live check of the REAL convertInquiry (lib/inquiries/convert.ts) against the hosted Supabase in .env.local.
 * Needs the fixture attorney 1 (Pat Example), client 1 (Sam Sample), branch Hartford, and status "Open"
 * (tests/cases/seed-fixtures.ts adds it). Invented inquiries tagged SUBJECT; they and their cases are removed in after().
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { loadEnvLocal } from "../app-shell/seed-e2e.ts";
import { createServerClient } from "../../lib/db/client.ts";
import { convertInquiry, existingCaseId } from "../../lib/inquiries/convert.ts";
import { todayIso } from "../../lib/inquiries/inquiries.ts";

loadEnvLocal();
const skip = process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY ? false : "no Supabase config in .env.local";
const SUBJECT = "Invented convert-live 990 warehouse shelf";
let db;
const ok = ({ data, error }) => { if (error) throw new Error(error.message); return data; };
const form = (o) => { const f = new FormData(); for (const [k, v] of Object.entries(o)) f.set(k, v); return f; };
const cleanup = async () => {
  const ids = ok(await db.from("tblinquiry").select("id").eq("inqsubject", SUBJECT)).map((r) => r.id);
  if (ids.length) ok(await db.from("tblcase").delete().in("caseinquiry", ids));
  ok(await db.from("tblinquiry").delete().eq("inqsubject", SUBJECT));
};
const newInquiry = async () =>
  ok(await db.from("tblinquiry").insert({ inqdate: "2026-09-11", inqsubject: SUBJECT, tabranch: "Hartford", inqattyid: 1 }).select("id").single()).id;

before(async () => { if (skip) return; db = createServerClient(); await cleanup(); });
after(async () => { if (db) await cleanup(); });

test("live: converts with the next case number, linked both ways as the smallint allows", { skip }, async () => {
  const inq = await newInquiry();
  const [{ caseid: max }] = ok(await db.from("tblcase").select("caseid").order("caseid", { ascending: false }).limit(1));
  const r = await convertInquiry(db, inq, form({ caseatty: "1", caseclient: "1", tabranch: "Hartford" }), new Date());
  assert.deepEqual(r, { ok: true, id: max + 1 });
  const row = ok(await db.from("tblcase").select("casetitle, casestartdate, status, tabranch, caseatty, caseclient, caseinquiry").eq("caseid", r.id).single());
  assert.deepEqual({ ...row, status: row.status.toLowerCase() }, {
    casetitle: SUBJECT, casestartdate: todayIso(new Date()), status: "open", tabranch: "Hartford", caseatty: 1, caseclient: 1, caseinquiry: inq,
  });
  const back = ok(await db.from("tblinquiry").select("inqresultingcase").eq("id", inq).single()).inqresultingcase;
  assert.equal(back, r.id <= 32767 ? r.id : null);
  assert.equal(await existingCaseId(db, { id: inq, inqresultingcase: back }), r.id);

  // A second convert of the same inquiry is refused and creates nothing.
  const again = await convertInquiry(db, inq, form({ caseatty: "1", caseclient: "1", tabranch: "Hartford" }), new Date());
  assert.deepEqual(again, { ok: false, error: "This inquiry already has a case." });
  assert.equal(ok(await db.from("tblcase").select("caseid").eq("caseinquiry", inq)).length, 1);
});

test("live: missing attorney or client is refused and no case is made", { skip }, async () => {
  const inq = await newInquiry();
  assert.equal((await convertInquiry(db, inq, form({ caseclient: "1", tabranch: "Hartford" }), new Date())).error, "Pick a case attorney before converting.");
  assert.equal((await convertInquiry(db, inq, form({ caseatty: "1", tabranch: "Hartford" }), new Date())).error, "Pick a case client before converting.");
  assert.equal(ok(await db.from("tblcase").select("caseid").eq("caseinquiry", inq)).length, 0);
});
