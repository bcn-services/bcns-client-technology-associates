/**
 * Live check of "Reverse bounced check" on /funds/[id] through the real dev server (BASE_URL, default
 * http://localhost:3100), the real reverseFundsAction, and runReverseFunds against the hosted DB (service-role Db).
 * Skips without the server or SUPABASE_SERVICE_ROLE_KEY. Invented cases 990910 (UI) and 990911 (concurrency),
 * copies of case 90001's tblcase row. after() deletes every tblbills / tblfundsrcvd row on those cases (reversal
 * rows included — same case, negative fndsid), the tblcase rows, and the throwaway admin.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { chromium } from "@playwright/test";
import { loadEnvLocal, seedE2eUser } from "../app-shell/seed-e2e.ts";
import { createServerClient } from "../../lib/db/client.ts";
import { runReverseFunds } from "../../lib/funds/reverse.ts";
import { firmToday } from "../../lib/cases/presets.ts";

loadEnvLocal();
const BASE = process.env.BASE_URL ?? "http://localhost:3100";
const EMAIL = process.env.E2E_EMAIL ?? "staff@example.test";
const ADMIN_EMAIL = `funds-rev-admin-${randomUUID().slice(0, 8)}@example.test`;
const ADMIN_PASSWORD = `pw-${randomUUID()}`;
const up = await fetch(`${BASE}/login`).then((r) => r.ok, () => false);
const skip = up && process.env.SUPABASE_SERVICE_ROLE_KEY ? false : "dev server or Supabase unavailable";
const CASE = 990910, CONC = 990911, CASES = [CASE, CONC];
let db, browser, staff, admin, adminId;
const ok = ({ data, error }) => { if (error) throw new Error(error.message); return data; };
const cleanup = async () => {
  ok(await db.from("tblfundsrcvd").delete().in("fndscaseid", CASES)); // before bills: fndsbillid → tblbills FK
  ok(await db.from("tblbills").delete().in("billcaseid", CASES));
  ok(await db.from("tblcase").delete().in("caseid", CASES));
};
const addBill = async (o) => ok(await db.from("tblbills").insert({ billcaseid: CASE, billdate: "2026-08-14", billhours: 2, billbalance: 450, billtype: "timesheet", billnotice: "Paid", billpaiddate: "2026-08-20", ...o }).select("billid").single()).billid;
const bill = async (id) => ok(await db.from("tblbills").select("*").eq("billid", id).single());
const addFunds = async (c, o = {}) => ok(await db.from("tblfundsrcvd").insert({ fndscaseid: c, fndsdate: "2026-08-20", fndspmt: "450.00", fndsbranch: "Stratford", fndspayee: "QA Rev Payee", fndssource: "Check", fndsdesc: "ck 1001", fndsbankaccount: "BoA", fndscomment: "orig comment", ...o }).select("fndsid").single()).fndsid;
const funds = async (id) => ok(await db.from("tblfundsrcvd").select("*").eq("fndsid", id).maybeSingle());
// Every row that is a reversal of `id`: by the negative id, or by any Bounced row on its cases naming it.
const reversals = async (id) => ok(await db.from("tblfundsrcvd").select("*").in("fndscaseid", CASES).or(`fndsid.eq.${-id},and(fndstype.eq.Bounced,fndscomment.ilike.*${id}*)`));
const unpaid = async (page) => { await page.goto(`/cases/${CASE}`); return Number(await page.getByTestId("unpaid-bill-count").innerText()); };
const REV = "Reverse bounced check";
const deps = (role, urls) => ({
  session: async () => ({ userId: "x", email: "x", role, personId: 2 }),
  db: () => db, now: () => new Date(), revalidatePath: () => {}, redirect: (u) => urls.push(u),
});

async function signIn(email, password) {
  const ctx = await browser.newContext({ baseURL: BASE });
  const page = await ctx.newPage();
  for (let i = 0; ; i++) {
    await page.goto("/login");
    await page.getByLabel(/email/i).fill(email);
    await page.getByLabel(/password/i).fill(password);
    await page.getByRole("button", { name: /sign in/i }).click();
    try { await page.waitForURL((u) => u.pathname !== "/login", { timeout: 20_000 }); break; } catch (e) { if (i >= 4) throw e; await page.waitForTimeout(3000 * (i + 1)); }
  }
  return page;
}

before(async () => {
  if (skip) return;
  db = createServerClient();
  await cleanup();
  const src = ok(await db.from("tblcase").select("*").eq("caseid", 90001).single());
  ok(await db.from("tblcase").insert(CASES.map((caseid) => ({ ...src, caseid }))));
  adminId = (await seedE2eUser(db, ADMIN_EMAIL, ADMIN_PASSWORD)).id;
  ok(await db.from("profiles").update({ role: "admin", personid: 2 }).eq("id", adminId));
  browser = await chromium.launch();
  staff = await signIn(EMAIL, process.env.E2E_PASSWORD ?? "password");
  admin = await signIn(ADMIN_EMAIL, ADMIN_PASSWORD);
});
after(async () => {
  await browser?.close();
  if (!db) return;
  await cleanup();
  if (adminId) { await db.from("profiles").delete().eq("id", adminId); await db.auth.admin.deleteUser(adminId); }
});

async function reverseInUi(fid, billid) {
  await admin.goto(`/funds/${fid}`);
  if (billid) await admin.getByLabel("Reopen bill", { exact: true }).selectOption(String(billid));
  await admin.getByRole("button", { name: REV }).click();
  await admin.waitForURL(new RegExp(`/funds/${fid}\\?reversed=-${fid}`));
  await admin.getByTestId("reverse-saved").waitFor();
}

test("450.00 reversal: one −450.00 Bounced row naming the original; original byte-for-byte unchanged; cleared fields fresh", { skip }, async () => {
  const fid = await addFunds(CASE, { fndsclearedbank: true, fndsdatecleared: "2026-08-25", fndsclearingnotes: "cleared ok" });
  const snap = await funds(fid);
  await reverseInUi(fid, 0);
  assert.deepEqual(await funds(fid), snap, "original row unchanged");
  const rows = await reversals(fid);
  assert.equal(rows.length, 1);
  const r = rows[0];
  assert.equal(r.fndsid, -fid);
  assert.equal(Number(r.fndspmt), -450);
  assert.equal(Number(r.fndspmt).toFixed(2), "-450.00", "exact −450.00");
  assert.equal(r.fndstype, "Bounced");
  assert.match(r.fndscomment, new RegExp(`\\b${fid}\\b`));
  assert.equal(r.fndsdate, firmToday(new Date()));
  assert.equal(r.fndscaseid, CASE);
  for (const k of ["fndspayee", "fndssource", "fndsdesc", "fndsbranch", "fndsbankaccount", "fndssafilename", "fndsbillfilename"]) assert.equal(r[k], snap[k], k);
  // Engineer's reading: cleared fields start fresh rather than copied.
  assert.equal(r.fndsclearedbank, false);
  assert.equal(r.fndsdatecleared, null);
  assert.equal(r.fndsclearingnotes, null);
  // Original page: control gone, reversed-by link shown.
  await admin.goto(`/funds/${fid}`);
  await admin.getByTestId("reversed-by").waitFor();
  assert.equal(await admin.getByRole("button", { name: REV }).count(), 0);
  // Reversal page: read-only, no control.
  await admin.goto(`/funds/${-fid}`);
  await admin.getByTestId("reversal-note").waitFor();
  assert.equal(await admin.getByRole("button", { name: REV }).count(), 0);
});

for (const [label, dates, want] of [
  ["final + second set → Final", { billsecondnoticedate: "2026-07-01", billfinalnoticedate: "2026-07-20" }, "Final"],
  ["final only set → Final", { billfinalnoticedate: "2026-07-21" }, "Final"],
  ["only second set → 2nd", { billsecondnoticedate: "2026-07-02" }, "2nd"],
  ["neither set → 1st", {}, "1st"],
]) {
  test(`picked Paid bill reopens: ${label}, billpaiddate null, unpaid-bill-count +1`, { skip }, async () => {
    const bid = await addBill(dates);
    const other = await addBill({ billdate: "2026-05-01" });
    const fid = await addFunds(CASE);
    const before = await unpaid(admin);
    await reverseInUi(fid, bid);
    const b = await bill(bid);
    assert.equal(b.billnotice, want);
    assert.equal(b.billpaiddate, null);
    assert.equal(b.billsecondnoticedate, dates.billsecondnoticedate ?? null);
    assert.equal(b.billfinalnoticedate, dates.billfinalnoticedate ?? null);
    assert.equal((await bill(other)).billnotice, "Paid", "unpicked bill untouched");
    assert.equal(await unpaid(admin), before + 1);
    assert.equal((await reversals(fid)).length, 1);
  });
}

test("concurrency: 5 rounds × 6 parallel runReverseFunds on the hosted DB → exactly one reversal row each", { skip }, async () => {
  for (let round = 0; round < 5; round++) {
    const fid = await addFunds(CONC, { fndspmt: `${100 + round}.25` });
    const snap = await funds(fid);
    const urls = [];
    await Promise.all(Array.from({ length: 6 }, () => runReverseFunds(fid, new FormData(), deps("admin", urls))));
    const rows = await reversals(fid);
    assert.equal(rows.length, 1, `round ${round}`);
    assert.equal(String(Number(rows[0].fndspmt).toFixed(2)), `-${100 + round}.25`);
    assert.equal(urls.filter((u) => u.includes("?reversed=")).length, 1, `round ${round}: ${urls}`);
    assert.equal(urls.filter((u) => u.includes("reverseerror=reversed")).length, 5, `round ${round}: ${urls}`);
    assert.deepEqual(await funds(fid), snap);
  }
});

test("concurrency: 3 simultaneous browser form posts → one reversal row", { skip }, async () => {
  const fid = await addFunds(CONC);
  const pages = [admin];
  for (let i = 0; i < 2; i++) {
    const ctx = await browser.newContext({ baseURL: BASE });
    await ctx.addCookies(await admin.context().cookies());
    pages.push(await ctx.newPage());
  }
  await Promise.all(pages.map((p) => p.goto(`/funds/${fid}`)));
  await Promise.all(pages.map((p) => p.getByRole("button", { name: REV }).waitFor()));
  await Promise.all(pages.map((p) => p.getByRole("button", { name: REV }).click()));
  await Promise.all(pages.map((p) => p.waitForURL(/[?&](reversed|reverseerror)=/)));
  assert.equal((await reversals(fid)).length, 1);
  const urls = pages.map((p) => p.url());
  assert.equal(urls.filter((u) => u.includes("?reversed=")).length, 1, urls.join(" "));
  assert.equal(urls.filter((u) => u.includes("reverseerror=reversed")).length, 2, urls.join(" "));
  for (const p of pages.slice(1)) await p.context().close();
});

test("a reversal row can never be reversed (by id, and via a positive-id Bounced/negative row)", { skip }, async () => {
  const fid = await addFunds(CONC, { fndspmt: "77.00" });
  const urls = [];
  await runReverseFunds(fid, new FormData(), deps("admin", urls));
  await runReverseFunds(-fid, new FormData(), deps("admin", urls));
  assert.match(urls[1], /reverseerror=reversal/);
  // A positive-id row that looks like a reversal (Bounced or negative amount) is refused too.
  const fake = await addFunds(CONC, { fndspmt: "-5.00", fndstype: "Bounced" });
  await runReverseFunds(fake, new FormData(), deps("admin", urls));
  assert.match(urls[2], /reverseerror=reversal/);
  assert.equal((await reversals(fake)).length, 0);
  assert.equal((await db.from("tblfundsrcvd").select("fndsid").eq("fndscaseid", CONC).eq("fndspmt", "77.00")).data.length, 1, "no re-reversal row");
  assert.equal((await reversals(fid)).length, 1);
});

test("staff: no Bounced check control; runReverseFunds with a staff session writes nothing", { skip }, async () => {
  const bid = await addBill({ billdate: "2026-08-23" });
  const fid = await addFunds(CASE);
  await staff.goto(`/funds/${fid}`);
  await staff.getByRole("heading", { name: /^Funds #/ }).waitFor();
  assert.equal(await staff.getByRole("region", { name: "Bounced check" }).count(), 0);
  assert.equal(await staff.getByRole("button", { name: REV }).count(), 0);
  const fd = new FormData();
  fd.set("bill", String(bid));
  const urls = [];
  await runReverseFunds(fid, fd, deps("staff", urls));
  assert.match(urls[0], /reverseerror=forbidden/);
  assert.equal((await reversals(fid)).length, 0);
  assert.equal((await bill(bid)).billnotice, "Paid");
});
