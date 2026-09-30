/**
 * Live check of Preview-then-Send (billing-output item 5) against the LOCAL Supabase stack:
 *  - in-process: the real runSend over the real DB and storage (a real invoice PDF saved by saveInvoicePdf), with
 *    RESEND_API_URL pointed at a Resend stub HTTP server started here on a random port — the real API is never called;
 *  - through the dev server (BASE_URL, default http://localhost:3150; it runs with NO Resend keys): the page renders
 *    the preview with Send disabled, the forced POST answers "not set up", and a staff replay of it is refused.
 * Own rows on invented case 992340 (copy of case 90001's tblcase row); rows and bills/99234x objects removed at setup
 * and in after(). Throwaway admin created/deleted with the service role.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { chromium } from "@playwright/test";
import { loadEnvLocal, seedE2eUser } from "../app-shell/seed-e2e.ts";
import { createServerClient } from "../../lib/db/client.ts";

loadEnvLocal();
const { getStorageAdapter } = await import("../../lib/storage.ts");
const { saveInvoicePdf } = await import("../../lib/bill-docs/invoice.ts");
const { readStoredFile } = await import("../../lib/bill-docs/send.ts");
const { runSend } = await import("../../lib/bills/send.ts");

const BASE = process.env.BASE_URL ?? "http://localhost:3150";
const EMAIL = process.env.E2E_EMAIL ?? "staff@example.test";
const ADMIN_EMAIL = `bill-send-admin-${randomUUID().slice(0, 8)}@example.test`;
const ADMIN_PASSWORD = `pw-${randomUUID()}`;
const skip = process.env.SUPABASE_SERVICE_ROLE_KEY ? false : "Supabase unavailable";
const up = !skip && await fetch(`${BASE}/login`).then((r) => r.ok, () => false);
const skipUi = up ? false : "dev server unavailable";
const CASE = 992340;
let db, stub, stubUrl, calls = [], reply = () => [200, { id: "stub-live" }];
const ok = ({ data, error }) => { if (error) throw new Error(error.message); return data; };
const bucket = () => db.storage.from("case-documents");
const cleanup = async () => {
  const keys = (ok(await bucket().list(`bills/${CASE}`, { limit: 1000 })) ?? []).map((f) => `bills/${CASE}/${f.name}`);
  if (keys.length) ok(await bucket().remove(keys));
  const bills = ok(await db.from("tblbills").select("billid").eq("billcaseid", CASE)).map((b) => b.billid);
  if (bills.length) ok(await db.from("tblbilllines").delete().in("billid", bills));
  ok(await db.from("tblbills").delete().eq("billcaseid", CASE));
  ok(await db.from("tblcase").delete().eq("caseid", CASE));
};
const bill = async (id) => ok(await db.from("tblbills").select("*").eq("billid", id).single());
/** A finalized one-line retainer bill with its invoice PDF stored for real. */
async function finalizedBill() {
  const B = ok(await db.from("tblbills").insert({
    billcaseid: CASE, billdate: "2026-09-07", billhours: 0, billbalance: "500.00", billtype: "retainer", billnotice: "1st",
    billfinalizedat: new Date().toISOString(),
  }).select("billid").single()).billid;
  ok(await db.from("tblbilllines").insert({ billid: B, lineno: 1, kind: "charge", linedate: "2026-09-07", description: "Initial Advance", amount: "500.00" }));
  await saveInvoicePdf(db, getStorageAdapter(), B, {});
  return B;
}
const form = (b, o = {}) => {
  const f = new FormData();
  const v = { token: randomUUID(), sentat: b.billsentat ?? "", to: "pat@example.test", cc: "cc@example.test", bcc: "", subject: "Re: Live edited subject", body: "Live edited body", ...o };
  for (const [k, x] of Object.entries(v)) f.set(k, x);
  return f;
};
async function send(B, f) {
  let url = null, state;
  try {
    state = await runSend(B, f, {
      session: async () => ({ userId: "u", email: "a@example.test", role: "admin", personId: null }),
      db: () => db,
      now: () => new Date(),
      config: () => ({ apiKey: "re_test_not_real", apiUrl: stubUrl, from: "billing@example.test" }),
      readPdf: (k) => readStoredFile(getStorageAdapter(), k),
      revalidatePath: () => {},
      redirect: (u) => { url = u; throw new Error("NEXT_REDIRECT"); },
    });
  } catch (e) { if (e.message !== "NEXT_REDIRECT") throw e; }
  return { state, url };
}

before(async () => {
  if (skip) return;
  db = createServerClient();
  await cleanup();
  const src = ok(await db.from("tblcase").select("*").eq("caseid", 90001).single());
  ok(await db.from("tblcase").insert({ ...src, caseid: CASE, casecaption: "Invented Caption v. Nobody", billingalert: false, billingcc: null }));
  stub = createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => { raw += c; });
    req.on("end", () => {
      calls.push({ url: req.url, headers: req.headers, body: JSON.parse(raw || "{}") });
      const [status, json] = reply();
      res.writeHead(status, { "content-type": "application/json" }).end(JSON.stringify(json));
    });
  });
  await new Promise((r) => stub.listen(0, "127.0.0.1", r));
  stubUrl = `http://127.0.0.1:${stub.address().port}`;
});
after(async () => {
  stub?.close();
  if (db) await cleanup();
});

test("live: send attaches the STORED PDF, records billsentat/billsentto; a concurrent double submit calls Resend once", { skip }, async () => {
  calls = []; reply = () => [200, { id: "stub-live" }];
  const B = await finalizedBill();
  const b0 = await bill(B);
  assert.ok(b0.billpdfpath);
  const f = form(b0, { to: "pat@example.test, lee@example.test" });
  const [r1, r2] = await Promise.all([send(B, f), send(B, f)]);
  assert.equal(calls.length, 1, `one provider call (${JSON.stringify([r1.state, r2.state])})`);
  assert.deepEqual([r1.url, r2.url].filter(Boolean), [`/bills/${B}/send?sent=1`]);
  assert.equal([r1.state, r2.state].find(Boolean).code, "stale");
  const c = calls[0];
  assert.equal(c.url, "/emails");
  assert.deepEqual([c.body.to, c.body.cc, c.body.subject, c.body.text], [["pat@example.test", "lee@example.test"], ["cc@example.test"], "Re: Live edited subject", "Live edited body"]);
  const attached = Buffer.from(c.body.attachments[0].content, "base64");
  const storedPdf = Buffer.from(await ok(await bucket().download(b0.billpdfpath)).arrayBuffer());
  assert.equal(attached.subarray(0, 5).toString(), "%PDF-");
  assert.ok(attached.equals(storedPdf), "attachment is the stored invoice");
  assert.equal(c.body.attachments[0].filename, b0.billpdfpath.slice(b0.billpdfpath.lastIndexOf("/") + 1));
  const b1 = await bill(B);
  assert.ok(b1.billsentat);
  assert.equal(b1.billsentto, "pat@example.test, lee@example.test");
  assert.equal((await send(B, f)).state.code, "stale", "replay after success");
  assert.equal(calls.length, 1);
});

test("live: a Resend failure records nothing and returns the provider's message; Send again then succeeds", { skip }, async () => {
  calls = []; reply = () => [403, { statusCode: 403, name: "validation_error", message: "The example.test domain is not verified." }];
  const B = await finalizedBill();
  const b0 = await bill(B);
  const r = await send(B, form(b0));
  assert.equal(r.state.code, "provider");
  assert.match(r.state.message, /403 The example\.test domain is not verified\./);
  const b1 = await bill(B);
  assert.deepEqual([b1.billsentat, b1.billsentto], [null, null], "never marked sent");
  reply = () => [200, { id: "stub-live-2" }];
  assert.equal((await send(B, form(b1))).url, `/bills/${B}/send?sent=1`);
  assert.ok((await bill(B)).billsentat);
  assert.equal(calls.length, 2);
});

test("live UI (no Resend keys on the dev server): preview renders pre-filled, PDF linked, Send disabled; forced POST → not set up; staff replay → forbidden", { skip: skip || skipUi }, async () => {
  const B = await finalizedBill();
  const before = await bill(B);
  const adminId = (await seedE2eUser(db, ADMIN_EMAIL, ADMIN_PASSWORD)).id;
  const browser = await chromium.launch();
  try {
    ok(await db.from("profiles").update({ role: "admin" }).eq("id", adminId));
    const signIn = async (email, password) => {
      const page = await (await browser.newContext({ baseURL: BASE })).newPage();
      for (let i = 0; ; i++) {
        await page.goto("/login");
        await page.getByLabel(/email/i).fill(email);
        await page.getByLabel(/password/i).fill(password);
        await page.getByRole("button", { name: /sign in/i }).click();
        try { await page.waitForURL((u) => u.pathname !== "/login", { timeout: 20_000 }); break; } catch (e) { if (i >= 4) throw e; await page.waitForTimeout(3000 * (i + 1)); }
      }
      return page;
    };
    const admin = await signIn(ADMIN_EMAIL, ADMIN_PASSWORD);
    await admin.goto(`/bills/${B}/send`, { timeout: 90_000 });
    await admin.getByLabel(/^to$/i).waitFor({ timeout: 60_000 });
    assert.equal(await admin.getByLabel(/^cc$/i).count(), 1);
    assert.equal(await admin.getByLabel(/subject/i).inputValue(), "Re: Invented Caption v. Nobody");
    assert.equal(await admin.getByRole("link", { name: /\.pdf|view pdf|open pdf/i }).count(), 1);
    const sendBtn = admin.getByRole("button", { name: /^send$/i });
    assert.equal(await sendBtn.isDisabled(), true, "Send disabled without keys");
    assert.match(await admin.getByTestId("send-off").innerText(), /not set up/);

    // Force the disabled button and capture the action POST: the server still refuses (email-off), nothing recorded.
    await admin.getByLabel(/^to$/i).fill("pat@example.test");
    await sendBtn.evaluate((el) => { el.disabled = false; });
    const reqP = admin.waitForRequest((r) => r.method() === "POST" && !!r.headers()["next-action"]);
    await sendBtn.click();
    const req = await reqP;
    await admin.getByTestId("send-error").waitFor({ timeout: 30_000 });
    assert.match(await admin.getByTestId("send-error").innerText(), /not set up/);

    const staff = await signIn(EMAIL, process.env.E2E_PASSWORD ?? "password");
    await staff.goto(`/bills/${B}/send`);
    assert.equal(await staff.getByRole("button", { name: /^send$/i }).count(), 0, "no Send for staff");
    const res = await staff.request.post(req.url(), { headers: { ...req.headers() }, data: req.postDataBuffer(), maxRedirects: 0 });
    assert.match(await res.text(), /"code":"forbidden"/, "staff replay refused");
    assert.deepEqual(await bill(B), before, "nothing recorded");
  } finally {
    await browser.close();
    await db.from("profiles").delete().eq("id", adminId);
    await db.auth.admin.deleteUser(adminId);
  }
});
