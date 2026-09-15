/**
 * Live check of the check → bill link (tblfundsrcvd.fndsbillid) through the real dev server (BASE_URL, default
 * http://localhost:3100) and the hosted DB. Skips without the server or SUPABASE_SERVICE_ROLE_KEY. Invented cases
 * 990970 (UI) and 990971 (direct runPayBill / concurrency), copies of case 90001's tblcase row. after() deletes every
 * tblbills / tblfundsrcvd row on those cases (reversal rows included) and the throwaway admin.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { chromium } from "@playwright/test";
import { loadEnvLocal, seedE2eUser } from "../app-shell/seed-e2e.ts";
import { createServerClient } from "../../lib/db/client.ts";
import { runPayBill } from "../../lib/funds/pay.ts";

loadEnvLocal();
const BASE = process.env.BASE_URL ?? "http://localhost:3100";
const ADMIN_EMAIL = `funds-link-admin-${randomUUID().slice(0, 8)}@example.test`;
const ADMIN_PASSWORD = `pw-${randomUUID()}`;
const up = await fetch(`${BASE}/login`).then((r) => r.ok, () => false);
const skip = up && process.env.SUPABASE_SERVICE_ROLE_KEY ? false : "dev server or Supabase unavailable";
const CASE = 990970, CONC = 990971, CASES = [CASE, CONC];
let db, browser, admin, adminId;
const ok = ({ data, error }) => { if (error) throw new Error(error.message); return data; };
const cleanup = async () => {
  ok(await db.from("tblfundsrcvd").delete().in("fndscaseid", CASES));
  ok(await db.from("tblbills").delete().in("billcaseid", CASES));
  ok(await db.from("tblcase").delete().in("caseid", CASES));
};
const addBill = async (o = {}) => ok(await db.from("tblbills").insert({ billcaseid: CASE, billdate: "2026-08-14", billhours: 2, billbalance: 450, billtype: "timesheet", billnotice: "1st", ...o }).select("billid").single()).billid;
const addFunds = async (o = {}) => ok(await db.from("tblfundsrcvd").insert({ fndscaseid: CASE, fndsdate: "2026-08-02", fndspmt: "450.00", fndsbranch: "Stratford", fndspayee: "QA Link Payee", ...o }).select("fndsid").single()).fndsid;
const bill = async (id) => ok(await db.from("tblbills").select("*").eq("billid", id).single());
const funds = async (id) => ok(await db.from("tblfundsrcvd").select("*").eq("fndsid", id).maybeSingle());
const payDeps = (urls) => ({ session: async () => ({ userId: "x", email: "x", role: "admin", personId: 2 }), db: () => db, revalidatePath: () => {}, redirect: (u) => urls.push(u) });
const payForm = (billid, notice, kind = "paid") => { const f = new FormData(); f.set("bill", `${billid}:${notice}`); f.set("kind", kind); return f; };
/** The case page's applied-check entries for one bill, as [href, text]. */
async function panelChecks(billid) {
  await admin.goto(`/cases/${CASE}`);
  const items = admin.getByTestId("bills-panel").getByTestId("bill-checks").locator(`[data-billid="${billid}"]`);
  return items.evaluateAll((els) => els.map((el) => [el.querySelector("a").getAttribute("href"), el.textContent]));
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
  const ctx = await browser.newContext({ baseURL: BASE });
  admin = await ctx.newPage();
  admin.setDefaultTimeout(60_000);
  for (let i = 0; ; i++) {
    await admin.goto("/login");
    await admin.getByLabel(/email/i).fill(ADMIN_EMAIL);
    await admin.getByLabel(/password/i).fill(ADMIN_PASSWORD);
    await admin.getByRole("button", { name: /sign in/i }).click();
    try { await admin.waitForURL((u) => u.pathname !== "/login", { timeout: 20_000 }); break; } catch (e) { if (i >= 4) throw e; await admin.waitForTimeout(3000 * (i + 1)); }
  }
});
after(async () => {
  await browser?.close();
  if (!db) return;
  await cleanup();
  if (adminId) { await db.from("profiles").delete().eq("id", adminId); await db.auth.admin.deleteUser(adminId); }
});

test("Mark bill paid links F to N: /funds/F shows 'Applied to bill N' instead of the select; case panel lists F under N", { skip }, async () => {
  const n = await addBill({ billdate: "2026-01-01" });
  const fid = await addFunds();
  await admin.goto(`/funds/${fid}?bill=${n}`);
  await admin.getByRole("button", { name: "Mark bill paid" }).click();
  await admin.waitForURL(new RegExp(`/funds/${fid}\\?paid=${n}`));
  const b = await bill(n);
  assert.equal(b.billnotice, "Paid");
  assert.equal((await funds(fid)).fndsbillid, n);
  const applied = admin.getByTestId("applied-bill");
  assert.equal((await applied.innerText()).trim(), `Applied to bill ${n}`);
  assert.equal(await applied.getByRole("link").getAttribute("href"), `/bills/${n}`);
  assert.equal(await admin.getByLabel("Bill", { exact: true }).count(), 0, "pay select replaced");
  assert.equal(await admin.getByRole("button", { name: "Mark bill paid" }).count(), 0);
  const items = await panelChecks(n);
  assert.equal(items.length, 1);
  assert.equal(items[0][0], `/funds/${fid}`);
  assert.match(items[0][1], /2026-08-02 · \$450\.00/);
});

test("Record partial payment links; a second check marking the bill paid is also linked → bill lists both checks", { skip }, async () => {
  const n = await addBill({ billdate: "2026-01-02" });
  const f1 = await addFunds({ fndspmt: "100.00" });
  const f2 = await addFunds({ fndspmt: "350.00", fndsdate: "2026-08-09" });
  await admin.goto(`/funds/${f1}?bill=${n}`);
  await admin.getByRole("button", { name: "Record partial payment" }).click();
  await admin.waitForURL(new RegExp(`\\?paid=${n}`));
  assert.equal((await bill(n)).billnotice, "Partial Payment");
  await admin.goto(`/funds/${f2}?bill=${n}`);
  assert.equal(await admin.getByLabel("Bill", { exact: true }).inputValue(), `${n}:Partial Payment`);
  await admin.getByRole("button", { name: "Mark bill paid" }).click();
  await admin.waitForURL(new RegExp(`\\?paid=${n}`));
  const b = await bill(n);
  assert.equal(b.billnotice, "Paid");
  assert.equal(b.billpaiddate, "2026-08-09");
  assert.deepEqual([(await funds(f1)).fndsbillid, (await funds(f2)).fndsbillid], [n, n]);
  const items = await panelChecks(n);
  assert.deepEqual(items.map((i) => i[0]).sort(), [`/funds/${f1}`, `/funds/${f2}`].sort());
  assert.ok(items.some((i) => /\$100\.00/.test(i[1])) && items.some((i) => /2026-08-09 · \$350\.00/.test(i[1])));
});

test("paying from an already-linked row is refused; neither the bill nor the row changes", { skip }, async () => {
  const n = await addBill({ billcaseid: CONC });
  const other = await addBill({ billcaseid: CONC, billdate: "2026-08-15" });
  const fid = await addFunds({ fndscaseid: CONC });
  const urls = [];
  await runPayBill(fid, payForm(n, "1st", "partial"), payDeps(urls));
  const [fb, bb] = [await funds(fid), await bill(other)];
  await runPayBill(fid, payForm(other, "1st"), payDeps(urls));
  assert.deepEqual(urls, [`/funds/${fid}?paid=${n}`, `/funds/${fid}?payerror=linked`]);
  assert.deepEqual(await funds(fid), fb);
  assert.deepEqual(await bill(other), bb);
});

test("concurrency: 5 rounds × 2 parallel pay submits from one row → exactly one link, exactly one bill updated", { skip }, async () => {
  for (let round = 0; round < 5; round++) {
    const a = await addBill({ billcaseid: CONC, billdate: `2026-03-0${round + 1}` });
    const c = await addBill({ billcaseid: CONC, billdate: `2026-04-0${round + 1}` });
    const fid = await addFunds({ fndscaseid: CONC });
    const urls = [];
    await Promise.all([runPayBill(fid, payForm(a, "1st"), payDeps(urls)), runPayBill(fid, payForm(c, "1st"), payDeps(urls))]);
    assert.equal(urls.filter((u) => u.includes("?paid=")).length, 1, `round ${round}: ${urls}`);
    assert.equal(urls.filter((u) => u.includes("payerror=linked")).length, 1, `round ${round}: ${urls}`);
    const won = Number(/paid=(\d+)/.exec(urls.join(" "))[1]);
    assert.equal((await funds(fid)).fndsbillid, won);
    const [ba, bc] = [await bill(a), await bill(c)];
    assert.deepEqual([ba.billnotice, bc.billnotice].sort(), ["1st", "Paid"], `round ${round}`);
    assert.equal((won === a ? ba : bc).billnotice, "Paid");
  }
});

test("reversing a linked check preselects its bill; reversal row carries fndsbillid; original unchanged; bill lists both", { skip }, async () => {
  const n = await addBill({ billdate: "2026-01-03" });
  const fid = await addFunds({ fndspmt: "225.00" });
  const urls = [];
  await runPayBill(fid, payForm(n, "1st"), payDeps(urls));
  assert.deepEqual(urls, [`/funds/${fid}?paid=${n}`]);
  const snap = await funds(fid);
  await admin.goto(`/funds/${fid}`);
  assert.equal(await admin.getByLabel("Reopen bill", { exact: true }).inputValue(), String(n), "linked bill preselected");
  await admin.getByRole("button", { name: "Reverse bounced check" }).click();
  await admin.waitForURL(new RegExp(`\\?reversed=-${fid}`));
  assert.deepEqual(await funds(fid), snap, "original row unchanged");
  const rev = await funds(-fid);
  assert.equal(rev.fndsbillid, n);
  assert.equal((await bill(n)).billnotice, "1st", "bill reopened");
  await admin.goto(`/funds/${-fid}`);
  assert.equal((await admin.getByTestId("applied-bill").innerText()).trim(), `Applied to bill ${n}`);
  const items = await panelChecks(n);
  assert.deepEqual(items.map((i) => i[0]).sort(), [`/funds/${-fid}`, `/funds/${fid}`].sort());
  assert.ok(items.some((i) => /\$-225\.00/.test(i[1])));
});

test("editing a linked row through the Edit funds form keeps fndsbillid", { skip }, async () => {
  const n = await addBill({ billdate: "2026-01-04" });
  const fid = await addFunds();
  await runPayBill(fid, payForm(n, "1st", "partial"), payDeps([]));
  await admin.goto(`/funds/${fid}`);
  const form = admin.getByRole("region", { name: "Edit funds" });
  await form.getByLabel("Amount").fill("451.00");
  await form.getByRole("button", { name: "Save" }).click();
  await admin.waitForURL(/\?saved=1/);
  const r = await funds(fid);
  assert.equal(Number(r.fndspmt), 451);
  assert.equal(r.fndsbillid, n);
  await admin.getByTestId("applied-bill").waitFor();
});
