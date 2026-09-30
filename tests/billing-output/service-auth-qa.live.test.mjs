/**
 * Item 7 QA, live: Chromium (Playwright) against the dev server (BASE_URL, default http://localhost:3150) and the local
 * Supabase stack. As staff and as admin (own synthetic @example.test users): Create SA on an invented case, download
 * and open the PDF (pdftotext), then change the status on the SA panel to Declined → Awaiting Approval → Approved and
 * read /cases/service-auths after each. Invented cases 993701/993702; rows, objects and users removed in after().
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { chromium } from "@playwright/test";
import { loadEnvLocal, seedE2eUser } from "../app-shell/seed-e2e.ts";
import { createServerClient } from "../../lib/db/client.ts";
import { firmToday } from "../../lib/cases/presets.ts";
import { defaultRates } from "../../lib/bills/rates.ts";

loadEnvLocal();
const BASE = process.env.BASE_URL ?? "http://localhost:3150";
const up = await fetch(`${BASE}/login`).then((r) => r.ok, () => false);
const poppler = spawnSync("pdftotext", ["-v"]).status === 0;
const skip = !up || !process.env.SUPABASE_SERVICE_ROLE_KEY ? "dev server or Supabase unavailable" : !poppler ? "pdftotext not installed" : false;
const ATTY = 993701, FIRM = 993701, PW = "qa-i7-password";
const USERS = { staff: { email: "qa-i7-staff@example.test", role: "staff", caseid: 993701 }, admin: { email: "qa-i7-admin@example.test", role: "admin", caseid: 993702 } };
const TMP = mkdtempSync(join(tmpdir(), "sa-qa-live-"));
let db, browser;
const ok = ({ data, error }) => { if (error) throw new Error(error.message); return data; };
const bucket = () => db.storage.from("case-documents");

async function cleanup() {
  for (const { caseid } of Object.values(USERS)) {
    const keys = (ok(await bucket().list(`service-auths/${caseid}`, { limit: 1000 })) ?? []).map((f) => `service-auths/${caseid}/${f.name}`);
    if (keys.length) ok(await bucket().remove(keys));
  }
  ok(await db.from("tblsrvauth").delete().gte("srvauthcaseid", 993700).lte("srvauthcaseid", 993799));
  ok(await db.from("tblactivity").delete().gte("actcaseid", 993700).lte("actcaseid", 993799));
  ok(await db.from("tblcase").delete().gte("caseid", 993700).lte("caseid", 993799));
  ok(await db.from("tblattorney").delete().eq("attyid", ATTY));
  ok(await db.from("tblfirm").delete().eq("frmid", FIRM));
}
async function dropUsers() {
  const { data } = await db.auth.admin.listUsers({ page: 1, perPage: 1000 });
  for (const u of data?.users ?? []) if (/^qa-i7-(staff|admin)@example\.test$/.test(u.email ?? "")) {
    await db.from("profiles").delete().eq("id", u.id);
    await db.auth.admin.deleteUser(u.id);
  }
}

before(async () => {
  if (skip) return;
  db = createServerClient();
  await cleanup();
  ok(await db.from("tblfirm").insert({ frmid: FIRM, frmname: "Invented Partners PLLC", frmphone: "0005550142", frmactive: true }));
  ok(await db.from("tblattorney").insert({ attyid: ATTY, attyfirmid: FIRM, attyfirstname: "Pat", attylastname: "Quillon" }));
  const src = ok(await db.from("tblcase").select("*").eq("caseid", 90001).single());
  for (const { caseid } of Object.values(USERS)) {
    ok(await db.from("tblcase").insert({ ...src, caseid, caseatty: ATTY, casestartdate: "2026-01-10", casecaption: "Court of Samples", casetitle: "Nobody v. Example" }));
    const a = (actdate, acthrs, actdescription, actbilled = false) => ({ actcaseid: caseid, actdate, acthrs, actdescription, actwho: 1, actbilled, actbillid: null });
    ok(await db.from("tblactivity").insert([a("2026-08-20", "1.500", "Inspected invented widget"), a("2026-08-21", "0.750", "Wrote placeholder findings"), a("2026-08-01", "9.000", "QA BILLED ROW", true)]));
  }
  for (const u of Object.values(USERS)) {
    const { id } = await seedE2eUser(db, u.email, PW);
    if (u.role === "admin") ok(await db.from("profiles").update({ role: "admin" }).eq("id", id));
  }
});
after(async () => {
  await browser?.close();
  if (db) { await cleanup(); await dropUsers(); }
  rmSync(TMP, { recursive: true, force: true });
});

const sa = async (id) => ok(await db.from("tblsrvauth").select("*").eq("srvauthid", id).single());
async function login(ctx, email) {
  const page = await ctx.newPage();
  for (let i = 0; ; i++) {
    await page.goto("/login", { timeout: 90_000 });
    await page.getByLabel(/email/i).fill(email);
    await page.getByLabel(/password/i).fill(PW);
    await page.getByRole("button", { name: /sign in/i }).click();
    try { await page.waitForURL((u) => u.pathname !== "/login", { timeout: 30_000 }); return page; } catch (e) { if (i >= 4) throw e; await page.waitForTimeout(3000 * (i + 1)); }
  }
}
/** Rows for `caseid` on a /cases/service-auths view: [[date, status], ...]. */
async function listRows(page, view, caseid) {
  await page.goto(`/cases/service-auths?view=${view}`, { timeout: 90_000 });
  return page.locator(`[data-testid="sa-${view}"] tbody tr`).filter({ has: page.locator(`a[href="/cases/${caseid}"]`) })
    .evaluateAll((trs) => trs.map((tr) => { const td = [...tr.querySelectorAll("td")].map((c) => c.textContent.trim()); return [td[0], td[6]]; }));
}
async function setStatus(page, caseid, id, status) {
  await page.goto(`/cases/${caseid}#service-auths`, { timeout: 90_000 });
  const form = page.locator(`form[data-testid="sa-row"][data-srvauthid="${id}"]`);
  await form.locator(`select[name="srvauthstatus"]`).selectOption(status);
  await form.getByRole("button", { name: "Update authorization" }).click();
  await page.waitForURL(/[?&]sa=1/, { timeout: 90_000 });
}

for (const [who, u] of Object.entries(USERS)) {
  test(`${who}: Create SA → download/open PDF → Declined/Awaiting/Approved on the panel; /cases/service-auths follows`, { skip }, async () => {
    browser ??= await chromium.launch();
    const ctx = await browser.newContext({ baseURL: BASE, acceptDownloads: true });
    const page = await login(ctx, u.email);
    const errors = [];
    page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
    const today = firmToday(new Date());
    const base = `SA${u.caseid} Quillon ${today.replaceAll("-", " ")}`;

    // Create SA (twice: the second gets -1) and download from the confirmation line.
    const ids = [];
    for (let n = 0; n < 2; n++) {
      await page.goto(`/cases/${u.caseid}`, { timeout: 90_000 });
      const panel = page.locator("#service-auths");
      assert.equal(await panel.getByRole("button", { name: /e-?mail|send/i }).count() + await panel.getByRole("link", { name: /e-?mail|send/i }).count(), 0, "no email/send control on the SA panel");
      await panel.getByRole("button", { name: "Create SA" }).click();
      const created = page.getByTestId("sa-created");
      await created.waitFor({ timeout: 90_000 });
      ids.push(Number(new URL(page.url()).searchParams.get("sa_new")));
      const row = await sa(ids[n]);
      assert.deepEqual([row.srvauthstatus, row.srvauthfile, String(row.srvauthdate).slice(0, 10), Number(row.srvauthhours), row.srvdateapproved],
        ["Awaiting Approval", `${base}-${n}`, today, 2.25, null]);
      const [dl] = await Promise.all([page.waitForEvent("download", { timeout: 90_000 }), created.getByRole("link").click()]);
      assert.equal(dl.suggestedFilename(), `${row.srvauthfile}.pdf`);
      const file = join(TMP, `${who}-${n}.pdf`);
      await dl.saveAs(file);
      const obj = Buffer.from(await ok(await bucket().download(`service-auths/${u.caseid}/${row.srvauthfile}.pdf`)).arrayBuffer());
      assert.ok(readFileSync(file).equals(obj), "downloaded bytes = the stored object named by srvauthfile");
      const text = execFileSync("pdftotext", [file, "-"], { encoding: "utf8" }).replace(/\s+/g, " ");
      for (const s of [`Court of Samples / Nobody v. Example / #${u.caseid}`, "Pat Quillon, Esq. / (000) 555-0142", "Invented Partners PLLC",
        `$${defaultRates(today, "2026-01-10").standard / 100}/hr`, "8/20/26", "Inspected invented widget", "1.50", "8/21/26", "Wrote placeholder findings", "0.75"])
        assert.ok(text.includes(s), `PDF missing "${s}"`);
      assert.ok(!text.includes("QA BILLED ROW"), "billed row printed");
    }
    const id = ids[0];
    assert.deepEqual((await listRows(page, "unapproved", u.caseid)).length, 2, "both new SAs pending");

    // Declined stamps today; leaves pending, not in approved.
    await setStatus(page, u.caseid, id, "Declined");
    assert.equal(String((await sa(id)).srvdateapproved).slice(0, 10), today);
    assert.equal(await page.locator(`form[data-srvauthid="${id}"] input[name="srvdateapproved"]`).inputValue(), today, "panel shows the stamped date");
    assert.equal((await listRows(page, "unapproved", u.caseid)).length, 1);
    assert.equal((await listRows(page, "approved", u.caseid)).length, 0);

    // Back to Awaiting Approval clears it; pending again.
    await setStatus(page, u.caseid, id, "Awaiting Approval");
    assert.equal((await sa(id)).srvdateapproved, null);
    assert.equal((await listRows(page, "unapproved", u.caseid)).length, 2);
    assert.equal((await listRows(page, "awaiting", u.caseid)).length, 2);

    // A dated row set to Approved keeps its date; the approved list shows that date.
    ok(await db.from("tblsrvauth").update({ srvdateapproved: "2026-02-03" }).eq("srvauthid", id));
    await setStatus(page, u.caseid, id, "Approved");
    assert.equal(String((await sa(id)).srvdateapproved).slice(0, 10), "2026-02-03");
    assert.deepEqual(await listRows(page, "approved", u.caseid), [["2026-02-03", "Approved"]]);
    assert.equal((await listRows(page, "unapproved", u.caseid)).length, 1);
    assert.deepEqual(errors, [], "browser console errors");
    await ctx.close();
  });
}

test("download route: anon is sent to login", { skip }, async () => {
  const row = ok(await db.from("tblsrvauth").select("srvauthid").eq("srvauthcaseid", USERS.staff.caseid).limit(1).single());
  const anon = await fetch(`${BASE}/cases/service-auths/pdf/${row.srvauthid}`, { redirect: "manual" });
  assert.ok([302, 303, 307].includes(anon.status) && /\/login/.test(anon.headers.get("location") ?? ""), `anon got ${anon.status}`);
});
