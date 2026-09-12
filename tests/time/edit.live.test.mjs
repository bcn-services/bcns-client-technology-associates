/**
 * Browser + replay check of /time/[id] edit/delete through the real page and actions (dev server at
 * BASE_URL, default http://localhost:3102). Skips when unreachable or Supabase is unconfigured.
 * Own rows live on invented case 990301 (a copy of case 90001's tblcase row); everything on
 * 990300–990399 is removed in after(). Fixture row 2 is only read and replayed against, never written.
 * The E2E staff login is linked to personid 1 in before() and restored in after(); a throwaway
 * admin (personid 2) is created and deleted with the service role.
 * `.bind(null, actid)` sends the actid in plaintext (`$ACTION_0:1=[actid]`), so replays forge it —
 * the write statement's filter is the only thing that can refuse them.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { chromium } from "@playwright/test";
import { loadEnvLocal, seedE2eUser } from "../app-shell/seed-e2e.ts";
import { createServerClient } from "../../lib/db/client.ts";
import { updateEntry, deleteEntry, TimeInputError } from "../../lib/time/entries.ts";

loadEnvLocal();
const BASE = process.env.BASE_URL ?? "http://localhost:3102";
const EMAIL = process.env.E2E_EMAIL ?? "staff@example.test";
const ADMIN_EMAIL = `time-edit-admin-${randomUUID().slice(0, 8)}@example.test`;
const ADMIN_PASSWORD = `pw-${randomUUID()}`;
const up = await fetch(`${BASE}/login`).then((r) => r.ok, () => false);
const skip = up && process.env.SUPABASE_SERVICE_ROLE_KEY ? false : "dev server or Supabase unavailable";
const CASE = 990301;
const LOCKED = "This entry can't be changed";
let db, browser, staff, admin, adminId, priorPersonId, row2, ids = {}, actions = {};
const ok = ({ data, error }) => { if (error) throw new Error(error.message); return data; };
const setPerson = async (v) => ok(await db.from("profiles").update({ personid: v }).eq("email", EMAIL));
const full = async (actid) => ok(await db.from("tblactivity").select("*").eq("actid", actid).maybeSingle());
const cleanup = async () => {
  ok(await db.from("tblactivity").delete().gte("actcaseid", 990300).lte("actcaseid", 990399));
  ok(await db.from("tblcase").delete().gte("caseid", 990300).lte("caseid", 990399));
};
const addRow = async (actwho, actdescription) =>
  ok(await db.from("tblactivity").insert({ actcaseid: CASE, actdate: "2026-09-08", actdescription, acthrs: "2", actwho }).select("actid").single()).actid;

async function signIn(email, password) {
  const ctx = await browser.newContext({ baseURL: BASE });
  const page = await ctx.newPage();
  for (let i = 0; ; i++) { // shared project → auth 429s; back off
    await page.goto("/login");
    await page.getByLabel(/email/i).fill(email);
    await page.getByLabel(/password/i).fill(password);
    await page.getByRole("button", { name: /sign in/i }).click();
    try { await page.waitForURL((u) => u.pathname !== "/login", { timeout: 20_000 }); break; } catch (e) { if (i >= 4) throw e; await page.waitForTimeout(3000 * (i + 1)); }
  }
  return page;
}

/** No-JS form POST of a server action with a forged bound actid; returns the redirect Location. */
async function replay(page, kind, actid, fields = {}) {
  const multipart = { "$ACTION_REF_0": "", "$ACTION_0:0": JSON.stringify({ id: actions[kind], bound: "$@1" }), "$ACTION_0:1": JSON.stringify([actid]), ...fields };
  const res = await page.request.post(`/time/${actid}`, { multipart, maxRedirects: 0 });
  return res.headers()["location"] ?? `(status ${res.status()})`;
}
const FORGED = { case: String(CASE), date: "2026-09-09", hours: "7", description: "Forged", actwho: "1", actbilled: "false", actbillid: "" };

before(async () => {
  if (skip) return;
  db = createServerClient();
  await cleanup();
  const src = ok(await db.from("tblcase").select("*").eq("caseid", 90001).single());
  ok(await db.from("tblcase").insert({ ...src, caseid: CASE }));
  row2 = await full(2);
  priorPersonId = ok(await db.from("profiles").select("personid").eq("email", EMAIL).single()).personid;
  await setPerson(1);
  adminId = (await seedE2eUser(db, ADMIN_EMAIL, ADMIN_PASSWORD)).id;
  ok(await db.from("profiles").update({ role: "admin", personid: 2 }).eq("id", adminId));
  ids = { edit: await addRow(1, "Own to edit"), del: await addRow(1, "Own to delete"), other: await addRow(2, "JON's row"), otherAdmin: await addRow(2, "JON's row, admin edits") };
  browser = await chromium.launch();
  staff = await signIn(EMAIL, process.env.E2E_PASSWORD ?? "password");
  admin = await signIn(ADMIN_EMAIL, ADMIN_PASSWORD);
  // Action ids from the real rendered forms: [0] is the update form, [1] the delete form.
  await staff.goto(`/time/${ids.edit}`);
  const refs = await staff.evaluate(() => [...document.querySelectorAll("form")].map((f) => new FormData(f).get("$ACTION_0:0") ?? new FormData(f).get("$ACTION_1:0")).filter(Boolean).map((v) => JSON.parse(v).id));
  [actions.update, actions.del] = refs;
});
after(async () => {
  await browser?.close();
  if (!db) return;
  await cleanup();
  await setPerson(priorPersonId ?? null);
  if (adminId) { await db.from("profiles").delete().eq("id", adminId); await db.auth.admin.deleteUser(adminId); }
});

test("setup: the rendered /time/[id] exposes an update and a delete action", { skip }, () => {
  assert.ok(actions.update && actions.del && actions.update !== actions.del, JSON.stringify(actions));
});

test("staff edits own unbilled row: hours + description persist, 'Entry saved', /time/<id> shows new values", { skip }, async () => {
  await staff.goto(`/time/${ids.edit}`);
  await staff.getByLabel(/hours/i).fill("3.25");
  await staff.getByLabel(/description/i).fill("Edited live");
  await staff.getByRole("button", { name: "Save" }).click();
  await staff.waitForURL((u) => u.pathname === "/time" && u.searchParams.get("saved") === "1" && u.searchParams.get("week") === "2026-09-08");
  assert.equal(await staff.getByText(/entry (added|saved)/i).count(), 1);
  const r = await full(ids.edit);
  assert.deepEqual({ ...r, acthrs: Number(r.acthrs) }, { actid: ids.edit, actcaseid: CASE, actdate: "2026-09-08", actdescription: "Edited live", acthrs: 3.25, actwho: 1, actbilled: false, actbillid: null });
  await staff.goto(`/time/${ids.edit}`);
  assert.equal(await staff.getByLabel(/hours/i).inputValue(), "3.25");
  assert.equal(await staff.getByLabel(/description/i).inputValue(), "Edited live");
});

test("control: admin replays update then delete on another person's unbilled row → saved (actwho unchanged), then deleted", { skip }, async () => {
  const loc = await replay(admin, "update", ids.otherAdmin, FORGED);
  assert.match(loc, /^\/time\?week=2026-09-09&saved=1$/);
  const r = await full(ids.otherAdmin);
  assert.deepEqual({ who: r.actwho, billed: r.actbilled, billid: r.actbillid, desc: r.actdescription, hrs: Number(r.acthrs) }, { who: 2, billed: false, billid: null, desc: "Forged", hrs: 7 });
  assert.match(await replay(admin, "del", ids.otherAdmin), /^\/time\?week=2026-09-09&deleted=1$/);
  assert.equal(await full(ids.otherAdmin), null);
});

test("fixture row 2 (billed): admin page is read-only, 'Billed…', no Save/Delete; staff page is 'Not found'", { skip }, async () => {
  await admin.goto("/time/2");
  await admin.getByText(row2.actbillid != null ? `Billed on bill ${row2.actbillid}` : /^Billed$/).waitFor();
  assert.equal(await admin.getByRole("button", { name: /save|delete/i }).count(), 0);
  assert.equal(await admin.getByLabel(/hours/i).inputValue(), String(Number(row2.acthrs)));
  assert.ok(await admin.getByLabel(/hours/i).isDisabled());
  await staff.goto("/time/2");
  await staff.getByText("Not found").waitFor();
});

test("fixture row 2: replayed update and delete (admin and staff) report 'can't be changed'; row 2 identical in every column", { skip }, async () => {
  for (const page of [admin, staff]) {
    for (const kind of ["update", "del"]) {
      const loc = await replay(page, kind, 2, kind === "update" ? FORGED : {});
      assert.match(loc, /^\/time\/2\?error=locked/, `${kind}`);
    }
  }
  await admin.goto("/time/2?error=locked");
  await admin.getByText(LOCKED).waitFor();
  assert.deepEqual(await full(2), row2);
});

test("fixture row 2: direct lib calls as admin (service-role client, no RLS) are refused 'locked'; row unchanged", { skip }, async () => {
  const locked = (e) => e instanceof TimeInputError && e.code === "locked";
  const s = { personId: 2, role: "admin" };
  await assert.rejects(updateEntry(db, s, 2, { caseId: "90001", date: "2026-01-16", hours: "9", description: "x" }), locked);
  await assert.rejects(deleteEntry(db, s, 2), locked);
  assert.deepEqual(await full(2), row2);
});

test("staff vs another person's unbilled row: page 'Not found', replayed update/delete refused, row identical", { skip }, async () => {
  const snap = await full(ids.other);
  await staff.goto(`/time/${ids.other}`);
  await staff.getByText("Not found").waitFor();
  assert.equal(await staff.getByRole("button", { name: /save|delete/i }).count(), 0);
  assert.match(await replay(staff, "update", ids.other, FORGED), new RegExp(`^/time/${ids.other}\\?error=locked`));
  assert.match(await replay(staff, "del", ids.other), new RegExp(`^/time/${ids.other}\\?error=locked`));
  assert.deepEqual(await full(ids.other), snap);
});

test("staff deletes own unbilled row with the Delete button: gone from tblactivity, 'Entry deleted'", { skip }, async () => {
  await staff.goto(`/time/${ids.del}`);
  await staff.getByRole("button", { name: "Delete" }).click();
  await staff.waitForURL((u) => u.pathname === "/time" && u.searchParams.get("deleted") === "1");
  assert.equal(await staff.getByText("Entry deleted").count(), 1);
  assert.equal(await full(ids.del), null);
});
