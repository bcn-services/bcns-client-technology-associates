/**
 * QA gate for billing-output item 3 (Finalize), live through the dev server (BASE_URL, default http://localhost:3150).
 * Independent of finalize.live.test.mjs: own invented cases 992401–992409 (copies of fixture case 90001's tblcase row),
 * everything on 992400–992499 removed at setup and in after() — lines and funds before bills. Stored values are read
 * back with psql straight from the local DB (LOCAL_PG_URL), not through the app. Screenshots go to $TMPDIR.
 * Skips without the server or SUPABASE_SERVICE_ROLE_KEY.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "@playwright/test";
import { loadEnvLocal, seedE2eUser } from "../app-shell/seed-e2e.ts";
import { createServerClient } from "../../lib/db/client.ts";

loadEnvLocal();
const BASE = process.env.BASE_URL ?? "http://localhost:3150";
const PG = process.env.LOCAL_PG_URL ?? "postgresql://postgres:postgres@127.0.0.1:54422/postgres";
const SHOTS = process.env.TMPDIR ?? tmpdir();
const ADMIN_EMAIL = `bill-qa3-admin-${randomUUID().slice(0, 8)}@example.test`;
const ADMIN_PASSWORD = `pw-${randomUUID()}`;
const up = await fetch(`${BASE}/login`).then((r) => r.ok, () => false);
const skip = up && process.env.SUPABASE_SERVICE_ROLE_KEY ? false : "dev server or Supabase unavailable";
const LO = 992400, HI = 992499;
let db, browser, staff, admin, adminId, nextCase = 992401;
const consoleErrors = [];

const ok = ({ data, error }) => { if (error) throw new Error(error.message); return data; };
const sql = (q) => execFileSync("psql", [PG, "-AtF|", "-c", q], { encoding: "utf8" }).trim();
const cleanup = async () => {
  const bills = ok(await db.from("tblbills").select("billid").gte("billcaseid", LO).lte("billcaseid", HI)).map((b) => b.billid);
  if (bills.length) ok(await db.from("tblbilllines").delete().in("billid", bills));
  ok(await db.from("tblfundsrcvd").delete().gte("fndscaseid", LO).lte("fndscaseid", HI));
  ok(await db.from("tblactivity").delete().gte("actcaseid", LO).lte("actcaseid", HI));
  ok(await db.from("tblbills").update({ supersedesbillid: null }).gte("billcaseid", LO).lte("billcaseid", HI));
  ok(await db.from("tblbills").delete().gte("billcaseid", LO).lte("billcaseid", HI));
  ok(await db.from("tblcase").delete().gte("caseid", LO).lte("caseid", HI));
};
const newCase = async (o = {}) => {
  const src = ok(await db.from("tblcase").select("*").eq("caseid", 90001).single());
  const id = nextCase++;
  ok(await db.from("tblcase").insert({ ...src, caseid: id, casestartdate: "2026-01-10", billingalert: false, billingcc: null, ...o }));
  return id;
};
const addBill = async (c, o = {}) => ok(await db.from("tblbills").insert({ billcaseid: c, billdate: "2026-09-01", billhours: 0, billbalance: 0, billtype: "timesheet", billnotice: "1st", ...o }).select("billid").single()).billid;
const addAct = async (c, b, h, who, date) => ok(await db.from("tblactivity").insert({ actcaseid: c, actdate: date, actdescription: `qa3 ${h}`, acthrs: h, actwho: who, actbilled: true, actbillid: b }).select("actid").single()).actid;
const snap = (b) => sql(`select billfinalizedat, billhours, billbalance, billtype from tblbills where billid=${b}`) + "#" +
  sql(`select string_agg(lineno||':'||kind||':'||coalesce(personid::text,'-')||':'||coalesce(rate::text,'-')||':'||amount, ',' order by lineno) from tblbilllines where billid=${b}`);
const balanceText = async (page, testid = "finalize-preview-total") => /Balance \$(-?[\d,]+\.\d\d)/.exec(await page.getByTestId(testid).innerText())?.[1]?.replaceAll(",", "");
const saveBtn = (page) => page.getByRole("button", { name: /finalize bill/i });

async function signIn(email, password) {
  const ctx = await browser.newContext({ baseURL: BASE });
  const page = await ctx.newPage();
  watch(page, email);
  for (let i = 0; ; i++) {
    await page.goto("/login");
    await page.getByLabel(/email/i).fill(email);
    await page.getByLabel(/password/i).fill(password);
    await page.getByRole("button", { name: /sign in/i }).click();
    try { await page.waitForURL((u) => u.pathname !== "/login", { timeout: 20_000 }); break; } catch (e) { if (i >= 4) throw e; await page.waitForTimeout(3000 * (i + 1)); }
  }
  return page;
}
function watch(page, who) {
  page.on("console", (m) => { if (m.type() === "error") consoleErrors.push(`${who} ${page.url()}: ${m.text()}`); });
  page.on("pageerror", (e) => consoleErrors.push(`${who} ${page.url()}: pageerror ${e.message}`));
}
async function clickCapture(page, button) {
  const reqP = page.waitForRequest((r) => r.method() === "POST" && !!r.headers()["next-action"]);
  await button.click();
  const req = await reqP;
  return { url: req.url(), headers: { ...req.headers() }, body: req.postDataBuffer() };
}
async function replay(page, cap) {
  const res = await page.request.post(cap.url, { headers: cap.headers, data: cap.body, maxRedirects: 0 });
  return { status: res.status(), to: res.headers()["x-action-redirect"] ?? res.headers()["location"] ?? "" };
}

before(async () => {
  if (skip) return;
  db = createServerClient();
  await cleanup();
  adminId = (await seedE2eUser(db, ADMIN_EMAIL, ADMIN_PASSWORD)).id;
  ok(await db.from("profiles").update({ role: "admin" }).eq("id", adminId));
  browser = await chromium.launch();
  staff = await signIn(process.env.E2E_EMAIL ?? "staff@example.test", process.env.E2E_PASSWORD ?? "password");
  admin = await signIn(ADMIN_EMAIL, ADMIN_PASSWORD);
});
after(async () => {
  await browser?.close();
  if (!db) return;
  await cleanup();
  if (adminId) { await db.from("profiles").delete().eq("id", adminId); await db.auth.admin.deleteUser(adminId); }
});

test("done-when 1 + screen = saved: KJS overridden, JON keeps 0.750 default ($326.25), a $200.50 credit, psql shows the stored lines", { skip }, async () => {
  const C = await newCase({ billingalert: true });
  const B = await addBill(C);
  await addAct(C, B, "2.000", 1, "2026-08-10");
  await addAct(C, B, "1.500", 2, "2026-08-11");
  ok(await db.from("tblfundsrcvd").insert({ fndscaseid: C, fndsdate: "2026-08-01", fndspmt: "200.50", fndsbranch: "Stratford", fndstype: "Check" }));
  await admin.goto(`/bills/${B}`);
  await admin.getByTestId("bill-finalize").click();
  await admin.waitForURL((u) => u.pathname === `/bills/${B}/finalize`);
  assert.equal(await admin.getByTestId("bill-recipient-alert").isVisible(), true, "BillingAlert banner");
  assert.equal(await admin.getByLabel("Rate for JON").inputValue(), "326.25");
  assert.match(await admin.getByText("default $326.25").innerText(), /default \$326\.25/, "default hint");
  assert.match(await admin.getByTestId("finalize-preview").innerText(), /Credit: .*200\.50/);
  await admin.getByLabel("Rate for KJS").fill("399.00");
  const screen = await balanceText(admin); // 2×399 + round(1.5×326.25) − 200.50 = 798 + 489 − 200.50
  assert.equal(screen, "1086.50");
  await admin.screenshot({ path: join(SHOTS, "qa3-timesheet-admin.png"), fullPage: true });
  await saveBtn(admin).click();
  await admin.waitForURL((u) => u.pathname === `/bills/${B}` && u.search === "?saved=1");

  const rates = sql(`select personid, rate, amount from tblbilllines where billid=${B} and personid is not null and rate is not null order by personid`);
  assert.equal(rates, "1|399.00|798.00\n2|326.25|489.00");
  assert.equal(sql(`select kind||'|'||amount from tblbilllines where billid=${B} and kind='credit'`), "credit|200.50");
  assert.equal(sql(`select billbalance from tblbills where billid=${B}`), screen, "saved total = screen total to the cent");
  assert.equal(sql(`select billhours::numeric(9,2)||'|'||(billfinalizedat is not null) from tblbills where billid=${B}`), "3.50|true");
});

test("staff: no Finalize control; a replayed admin POST is refused by the action and changes nothing", { skip }, async () => {
  const C = await newCase();
  const B = await addBill(C);
  await addAct(C, B, "1.000", 1, "2026-08-10");
  await staff.goto(`/bills/${B}`);
  assert.equal(await staff.getByTestId("bill-finalize").count(), 0);
  assert.equal(await staff.getByRole("link", { name: /finalize/i }).count(), 0);
  await staff.goto(`/bills/${B}/finalize`);
  assert.equal(await saveBtn(staff).count(), 0);
  assert.equal(await staff.getByRole("textbox").count(), 0);
  await staff.screenshot({ path: join(SHOTS, "qa3-staff-finalize.png"), fullPage: true });

  // Capture a real admin POST, un-finalize, replay as staff.
  await admin.goto(`/bills/${B}/finalize`);
  const cap = await clickCapture(admin, saveBtn(admin));
  await admin.waitForURL((u) => u.pathname === `/bills/${B}`);
  sql(`delete from tblbilllines where billid=${B}; update tblbills set billfinalizedat=null, billhours=0, billbalance=0 where billid=${B}`);
  const before = snap(B);
  const r = await replay(staff, cap);
  console.log(`# staff replay → HTTP ${r.status}, redirect ${r.to}`);
  assert.match(r.to, new RegExp(`/bills/${B}/finalize\\?error=forbidden`));
  assert.equal(snap(B), before, "0 rows changed");
});

test("stale: two tabs (second submit) and an activity row added after render both → ?error=stale, 0 rows changed", { skip }, async () => {
  const C = await newCase();
  const B = await addBill(C);
  await addAct(C, B, "2.000", 1, "2026-08-10");
  const tab2 = await admin.context().newPage();
  watch(tab2, "admin-tab2");
  await admin.goto(`/bills/${B}/finalize`);
  await tab2.goto(`/bills/${B}/finalize`);
  await tab2.getByLabel("Rate for KJS").fill("400.00");
  await saveBtn(admin).click();
  await admin.waitForURL((u) => u.pathname === `/bills/${B}`);
  const done = snap(B);
  await saveBtn(tab2).click();
  await tab2.waitForURL((u) => u.search === "?error=stale");
  assert.match(await tab2.getByRole("alert").first().innerText(), /changed meanwhile/);
  assert.equal(snap(B), done, "second tab changed 0 rows");
  await tab2.close();

  const B2 = await addBill(C);
  await addAct(C, B2, "2.000", 1, "2026-08-12");
  await admin.goto(`/bills/${B2}/finalize`);
  await addAct(C, B2, "0.500", 2, "2026-08-13"); // lands after render
  const open = snap(B2);
  await saveBtn(admin).click();
  await admin.waitForURL((u) => u.pathname === `/bills/${B2}/finalize` && u.search === "?error=stale");
  assert.equal(snap(B2), open, "0 rows changed");
});

test("legacy: no control, and the action refuses a bill that became legacy after render", { skip }, async () => {
  const C = await newCase();
  const L = await addBill(C, { billtype: null, billbalance: 75.5 });
  await admin.goto(`/bills/${L}`);
  assert.equal(await admin.getByTestId("bill-finalize").count(), 0);
  await admin.goto(`/bills/${L}/finalize`);
  assert.equal(await saveBtn(admin).count(), 0);
  const B = await addBill(C);
  await addAct(C, B, "1.000", 1, "2026-08-10");
  await admin.goto(`/bills/${B}/finalize`);
  sql(`update tblbills set billtype=null where billid=${B}`);
  const open = snap(B);
  await saveBtn(admin).click();
  await admin.waitForURL((u) => u.pathname === `/bills/${B}/finalize` && u.search === "?error=legacy");
  assert.equal(snap(B), open);
});

// Review fix (item 3): the column-overflow rate is now refused before the claim (?error=too-large) instead of reaching the
// insert-failure undo; the bill must still keep its ORIGINAL non-zero hours and balance.
test("too large: a forced submit of a rate the column can't hold leaves the bill unfinalized with its ORIGINAL hours and balance", { skip }, async () => {
  const C = await newCase();
  const B = await addBill(C, { billhours: 4.25, billbalance: 612.34 });
  await addAct(C, B, "1.000", 1, "2026-08-10");
  await admin.goto(`/bills/${B}/finalize`);
  await admin.getByLabel("Rate for KJS").fill("999999999.00"); // overflows tblbilllines.rate numeric(10,2)
  await admin.locator('form[data-testid="finalize-form"]').evaluate((f) => f.requestSubmit()); // Save is disabled; bypass it
  await admin.waitForURL((u) => u.search === "?error=too-large", { timeout: 20_000 }).catch(async (e) => { console.log(`# landed at ${admin.url()} snap ${snap(B)}`); throw e; });
  assert.equal(sql(`select coalesce(billfinalizedat::text,'null')||'|'||billhours::numeric(9,2)||'|'||billbalance from tblbills where billid=${B}`), "null|4.25|612.34");
  assert.equal(sql(`select count(*) from tblbilllines where billid=${B}`), "0");
});

test("trial estimate editing: Add line, edit hours, location on Travel & court time, keyboard rate entry; live total = saved", { skip }, async () => {
  const C = await newCase({ billingalert: true });
  const T = await addBill(C, { billtype: "trial" });
  await admin.goto(`/bills/${T}/finalize`);
  assert.equal(await admin.getByTestId("bill-recipient-alert").isVisible(), true);
  assert.equal(await balanceText(admin), "8480.00"); // 8×435 + 10×490 + 100
  await admin.getByRole("button", { name: "Add line" }).first().click();
  await admin.getByLabel("Estimate 1 line 3 description").fill("Draft exhibit list");
  await admin.getByLabel("Estimate 1 line 3 hours").fill("1.5");
  await admin.getByLabel("Estimate 1 line 1 hours").fill("5");
  assert.equal(await balanceText(admin), "8698.00"); // round(8.5×435)=3698 + 4900 + 100
  const travel = admin.getByLabel("Estimate 2 line 1 description");
  await travel.fill(`${await travel.inputValue()} (Bridgeport)`);
  assert.match(await admin.getByTestId("finalize-preview").innerText(), /Travel & court time \(Bridgeport\)/);
  // Visible labels, then keyboard-only rate entry.
  for (const name of ["Estimate 1 rate", "Estimate 2 rate", "Expense 1 amount"]) {
    assert.equal(await admin.getByText(name, { exact: true }).isVisible(), true, `visible label: ${name}`);
  }
  await admin.getByLabel("Estimate 1 rate").focus();
  await admin.keyboard.press("ControlOrMeta+a");
  await admin.keyboard.type("400");
  assert.equal(await admin.getByLabel("Estimate 2 rate").inputValue(), "450.00", "testimony follows legacy map");
  await admin.keyboard.press("Tab");
  const focused = await admin.evaluate(() => document.activeElement?.getAttribute("name") ?? document.activeElement?.textContent);
  const screen = await balanceText(admin); // round(8.5×400)=3400 + 10×450 + 100
  assert.equal(screen, "8000.00");
  await admin.screenshot({ path: join(SHOTS, "qa3-trial-admin.png"), fullPage: true });
  await saveBtn(admin).click();
  await admin.waitForURL((u) => u.pathname === `/bills/${T}`);
  assert.equal(sql(`select billbalance from tblbills where billid=${T}`), screen);
  assert.equal(sql(`select count(*) from tblbilllines where billid=${T} and description='Travel & court time (Bridgeport)'`), "1");
  assert.equal(sql(`select count(*) from tblbilllines where billid=${T} and description='Draft exhibit list' and hours=1.5`), "1");
  assert.ok(focused, "Tab moves focus off the rate box");
});

test("unknown person warning and 'Nothing to bill'", { skip }, async () => {
  const C = await newCase();
  const B = await addBill(C);
  await addAct(C, B, "1.000", 1, "2026-08-10");
  // An orphan actwho as legacy data has it (the FK is NOT VALID; bypass it for this insert only).
  sql(`set session_replication_role = replica; insert into tblactivity (actcaseid, actdate, actdescription, acthrs, actwho, actbilled, actbillid) values (${C}, '2026-08-11', 'qa3 orphan', 2.000, 99, true, ${B})`);
  await admin.goto(`/bills/${B}/finalize`);
  assert.match(await admin.getByTestId("finalize-warning").innerText(), /Person #99 has no billing name — their 2 hrs/);
  assert.equal(await admin.getByLabel("Rate for time with no person").inputValue(), "435.00");
  const screen = await balanceText(admin);
  assert.equal(screen, "1305.00");
  await admin.screenshot({ path: join(SHOTS, "qa3-unknown-person.png"), fullPage: true });
  await saveBtn(admin).click();
  await admin.waitForURL((u) => u.pathname === `/bills/${B}`);
  assert.equal(sql(`select billbalance from tblbills where billid=${B}`), screen);

  const E = await addBill(C);
  await admin.goto(`/bills/${E}/finalize`);
  assert.match(await admin.getByTestId("finalize-empty").innerText(), /Nothing to bill/);
  await admin.screenshot({ path: join(SHOTS, "qa3-nothing-to-bill.png"), fullPage: true });
});

test("no browser console errors across the flows above", { skip }, () => {
  assert.deepEqual(consoleErrors, []);
});
