/**
 * Live check against the Supabase project in .env.local: seeds the invented fixture rows,
 * then creates → edits a firm, an attorney attached to it, and a client through the same
 * parseForm/createContact/updateContact the server action uses, re-reading each from the DB.
 * Rows it creates are named "Contacts Live <tag>" (invented); there is no delete path, so they stay.
 * Skips when .env.local has no Supabase config or no DATABASE_URL (the sequence sync needs it — CI's shadow stack has none).
 */
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { loadEnvLocal } from "../app-shell/seed-e2e.ts";
import { createServerClient } from "../../lib/db/client.ts";
import { seedFixtures, syncSequences } from "./seed-fixtures.ts";
import { SPECS, parseForm, createContact, updateContact, loadContact, loadAttorneyWithFirm } from "../../lib/contacts/contacts.ts";
import { runPreset } from "../../lib/contacts/presets.ts";

loadEnvLocal();
const skip = process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY && process.env.DATABASE_URL ? false : "no Supabase config or DATABASE_URL in .env.local";
const tag = randomUUID().slice(0, 8);
let db;

before(async () => {
  if (skip) return;
  db = createServerClient();
  await seedFixtures(db);
  assert.ok(syncSequences(), "DATABASE_URL needed to move identity sequences past the fixture ids");
  const { error } = await db.from("tblstates").upsert({ state: "NY" }, { onConflict: "state" });
  if (error) throw new Error(error.message);
});

const fd = (o) => { const f = new FormData(); for (const [k, v] of Object.entries(o)) if (v !== false) f.set(k, v === true ? "on" : String(v)); return f; };

/** Create with `a`, re-read, edit to `b`, re-read: every legacy column must round-trip both times. */
async function roundTrip(kind, a, b) {
  const cols = SPECS[kind].fields.map((f) => f.col);
  assert.deepEqual(Object.keys(a).sort(), [...cols].sort(), "test input covers every legacy field");
  const id = await createContact(db, kind, parseForm(kind, fd(a)));
  const created = await loadContact(db, kind, id);
  for (const c of cols) assert.equal(created[c], a[c], `create ${kind}.${c}`);
  const changes = await updateContact(db, kind, id, parseForm(kind, fd(b)));
  const edited = await loadContact(db, kind, id);
  for (const c of cols) assert.equal(edited[c], b[c], `edit ${kind}.${c}`);
  assert.deepEqual(Object.keys(changes).sort(), cols.filter((c) => a[c] !== b[c]).sort(), "only changed columns written");
  assert.deepEqual(await updateContact(db, kind, id, parseForm(kind, fd(b))), {}, "unchanged save writes nothing");
  return id;
}

test("create then edit a firm, an attorney attached to it, and a client — every legacy field persists", { skip }, async () => {
  const firmId = await roundTrip("firm",
    { frmname: `Contacts Live ${tag} LLP`, frmaddress1: "1 Test Way", frmaddress2: "Suite 1", frmcity: "Hartford", frmstate: "CT", frmzip: "06101", frmphone: "555-0100", frmfax: "555-0101", frmemail: "live@example.test", frmpracticetype: "Plaintiff", frmsize: "Small", frmactive: "Yes" },
    { frmname: `Contacts Live ${tag} Group`, frmaddress1: "2 Test Way", frmaddress2: "Suite 2", frmcity: "Albany", frmstate: "NY", frmzip: "12207", frmphone: "555-0200", frmfax: "555-0201", frmemail: "live2@example.test", frmpracticetype: "Defendent", frmsize: "Large", frmactive: "No" });
  const attyId = await roundTrip("attorney",
    { attyfirmid: firmId, attytitle: "Mr.", attyfirstname: "Lee", attymiddlename: "Q", attylastname: `Live${tag}`, attysuffix: "Jr.", attyesq: true, attyphone: "555-0300", attyemail: "lee@example.test", attycellphone: "555-0301" },
    { attyfirmid: firmId, attytitle: "Dr.", attyfirstname: "Leigh", attymiddlename: "R", attylastname: `Live${tag}x`, attysuffix: "III", attyesq: false, attyphone: "555-0400", attyemail: "leigh@example.test", attycellphone: "555-0401" });
  const opened = await loadAttorneyWithFirm(db, attyId);
  assert.equal(opened.firm.frmid, firmId, "attorney attached to the new firm");
  await roundTrip("client",
    { clienttitle: "Ms.", clientfirstname: "Cam", clientlastname: `Live${tag}`, clientphone: "555-0500", clientnotes: "first note" },
    { clienttitle: "Mrs.", clientfirstname: "Cami", clientlastname: `Live${tag}y`, clientphone: "555-0600", clientnotes: "second note\nline 2" });
});

test("fixture attorney Pat Example opens showing firm Example & Partners LLP", { skip }, async () => {
  const { atty, firm } = await loadAttorneyWithFirm(db, 1);
  assert.equal(`${atty.attyfirstname} ${atty.attylastname}`, "Pat Example");
  assert.equal(firm.frmname, "Example & Partners LLP");
});

test("presets run against the hosted schema and include the fixture rows", { skip }, async () => {
  const active = await runPreset(db, "active-firms", "yes");
  assert.ok(active.some((r) => r.attyid === 1 && r.frmname === "Example & Partners LLP"));
  assert.ok(!active.some((r) => String(r.frmactive).toLowerCase() !== "yes"), "only stored 'yes' values");
  assert.ok((await runPreset(db, "by-state", "ct")).some((r) => r.caseid === 90001));
  assert.ok((await runPreset(db, "attorney-ids")).some((r) => r.caseid === 90001 && r.attylastname === "Example"));
  assert.ok((await runPreset(db, "duplicates")).some((r) => r.attyid === 1));
  assert.ok((await runPreset(db, "rename")).some((r) => r.attyname === "Pat Example"));
});
