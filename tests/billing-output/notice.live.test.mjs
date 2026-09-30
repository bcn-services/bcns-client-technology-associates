/**
 * Item 6 live: notice resend against the LOCAL Supabase stack (real DB + real storage) — in-process runSend(kind
 * "notice") with the production readStoredFile / writeStoredFile, RESEND_API_URL pointed at a Resend stub on a random
 * port (the real API is never called). Reads the stored original before/after and the stored notice object.
 * Own invented case 993662 (copy of fixture case 90001's row); its bills, lines and bills/993662 objects are removed
 * before and after.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { PDFDocument, PDFName, PDFDict } from "pdf-lib";
import { chromium } from "@playwright/test";
import { loadEnvLocal, seedE2eUser } from "../app-shell/seed-e2e.ts";
import { createServerClient } from "../../lib/db/client.ts";

loadEnvLocal();
const { getStorageAdapter } = await import("../../lib/storage.ts");
const { saveInvoicePdf } = await import("../../lib/bill-docs/invoice.ts");
const { readStoredFile, writeStoredFile } = await import("../../lib/bill-docs/send.ts");
const { noticeKey, stampNotice } = await import("../../lib/bill-docs/notice.ts");
const { runSend, loadSend, noticeEmailDraft } = await import("../../lib/bills/send.ts");

const skip = process.env.SUPABASE_SERVICE_ROLE_KEY ? false : "Supabase unavailable";
const BASE = process.env.BASE_URL ?? "http://localhost:3150";
const up = !skip && await fetch(`${BASE}/login`).then((r) => r.ok, () => false);
const skipUi = up ? false : "dev server unavailable";
const ADMIN_EMAIL = `notice-admin-${randomUUID().slice(0, 8)}@example.test`, ADMIN_PASSWORD = `pw-${randomUUID()}`;
const CASE = 993662;
let db, stub, stubUrl, hits = [];
const must = ({ data, error }) => { if (error) throw new Error(error.message); return data; };
const bucket = () => db.storage.from("case-documents");
const download = async (k) => Buffer.from(await must(await bucket().download(k)).arrayBuffer());
async function wipe() {
  const keys = (must(await bucket().list(`bills/${CASE}`, { limit: 1000 })) ?? []).map((f) => `bills/${CASE}/${f.name}`);
  if (keys.length) must(await bucket().remove(keys));
  const ids = must(await db.from("tblbills").select("billid").eq("billcaseid", CASE)).map((b) => b.billid);
  if (ids.length) must(await db.from("tblbilllines").delete().in("billid", ids));
  must(await db.from("tblbills").delete().eq("billcaseid", CASE));
  must(await db.from("tblcase").delete().eq("caseid", CASE));
}
const read = async (id) => must(await db.from("tblbills").select("*").eq("billid", id).single());
const noticeCols = (b) => JSON.stringify([b.billnotice, b.billsecondnoticedate, b.billfinalnoticedate]);
async function act(id, f) {
  const out = { url: null, state: null };
  try {
    out.state = await runSend(id, f, {
      session: async () => ({ userId: "n6", email: "n6@example.test", role: "admin", personId: null }),
      db: () => db, now: () => new Date(),
      config: () => ({ apiKey: "re_test_stub", apiUrl: stubUrl, from: "bills@example.test" }),
      readPdf: (k) => readStoredFile(getStorageAdapter(), k),
      writePdf: (k, b) => writeStoredFile(getStorageAdapter(), k, b),
      revalidatePath: () => {},
      redirect: (u) => { out.url = u; throw new Error("NEXT_REDIRECT"); },
    }, "notice");
  } catch (e) { if (e.message !== "NEXT_REDIRECT") throw e; }
  return out;
}
const imagesOnPage1 = async (bytes) => {
  const d = await PDFDocument.load(bytes);
  const xo = d.getPage(0).node.Resources()?.lookupMaybe(PDFName.of("XObject"), PDFDict);
  return [...(xo?.entries() ?? [])].filter(([, r]) => d.context.lookup(r).dict.get(PDFName.of("Subtype"))?.toString() === "/Image").length;
};

/** A finalized one-line retainer bill at `notice`, with (pdf) or without its invoice PDF stored. */
async function noticeBill(notice, pdf = true) {
  const id = must(await db.from("tblbills").insert({
    billcaseid: CASE, billdate: "2026-07-14", billhours: 0, billbalance: "480.00", billtype: "retainer", billnotice: notice,
    billsecondnoticedate: "2026-08-20", billfinalizedat: new Date().toISOString(),
  }).select("billid").single()).billid;
  must(await db.from("tblbilllines").insert({ billid: id, lineno: 1, kind: "charge", linedate: "2026-07-14", description: "Invented notice advance", amount: "480.00" }));
  if (pdf) await saveInvoicePdf(db, getStorageAdapter(), id, {});
  return id;
}

before(async () => {
  if (skip) return;
  db = createServerClient();
  await wipe();
  const src = must(await db.from("tblcase").select("*").eq("caseid", 90001).single());
  must(await db.from("tblcase").insert({ ...src, caseid: CASE, casecaption: "Notice Caption v. Nobody", billingalert: false, billingcc: "para6@example.test" }));
  stub = createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => { raw += c; });
    req.on("end", () => {
      hits.push({ headers: req.headers, body: JSON.parse(raw || "{}") });
      res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ id: "n6-live" }));
    });
  });
  await new Promise((r) => stub.listen(0, "127.0.0.1", r));
  stubUrl = `http://127.0.0.1:${stub.address().port}`;
});
after(async () => { stub?.close(); if (db) await wipe(); });

test("live: 2nd then Final notice — stamped stored PDF saved beside the original, original bytes unchanged, BCC + body variant sent, notice fields untouched", { skip }, async () => {
  hits = [];
  const id = await noticeBill("2nd");
  const b0 = await read(id);
  assert.ok(b0.billpdfpath);
  const original = await download(b0.billpdfpath);

  for (const [notice, word, usps] of [["2nd", "SecondNotice", false], ["Final", "FinalNotice", true]]) {
    if (notice === "Final") must(await db.from("tblbills").update({ billnotice: "Final", billfinalnoticedate: "2026-09-21" }).eq("billid", id));
    const b = await read(id);
    const draft = noticeEmailDraft(await loadSend(db, id), "archive6@example.test");
    const f = new FormData();
    for (const [k, v] of Object.entries({ token: randomUUID(), sentat: b.billsentat ?? "", notice: b.billnotice, ...draft, to: "atty6@example.test" })) f.set(k, v);
    const r = await act(id, f);
    assert.equal(r.url, `/bills/${id}/notice?sent=1`, JSON.stringify(r.state));
    const h = hits.at(-1).body;
    assert.deepEqual([h.to, h.cc, h.bcc], [["atty6@example.test"], ["para6@example.test"], ["archive6@example.test"]]);
    assert.equal(h.text.includes("A copy has also been mailed via USPS."), usps, notice);
    assert.match(hits.at(-1).headers["idempotency-key"], new RegExp(`^notice-${word}-${id}-`));

    const after = await read(id);
    assert.equal(noticeCols(after), noticeCols(b), `${notice}: billnotice / notice dates byte-identical`);
    assert.equal(after.billpdfpath, b0.billpdfpath);
    assert.ok((await download(b0.billpdfpath)).equals(original), `${notice}: stored original bytes unchanged`);
    const key = noticeKey(b0.billpdfpath, notice);
    assert.equal(key, b0.billpdfpath.replace(/\.pdf$/, ` ${word}.pdf`));
    const stored = await download(key);
    const att = Buffer.from(h.attachments[0].content, "base64");
    assert.ok(stored.equals(att), `${notice}: stored notice object == attachment`);
    assert.ok(stored.equals(Buffer.from(await stampNotice(original, notice))), `${notice}: notice = original + stamp`);
    assert.equal(await imagesOnPage1(stored), 1, "stamp image on page 1");
    assert.equal(await imagesOnPage1(original), 0);
  }
  assert.equal(hits.length, 2);
});

test("live UI (dev server, no Resend keys): admin sees Send notice on /bills and the bill page, the notice preview + stamped PDF (not saved); no-PDF bill says why; staff get no link and no Send", { skip: skip || skipUi }, async () => {
  const id = await noticeBill("2nd"), bare = await noticeBill("Final", false);
  const b0 = await read(id);
  const keysBefore = must(await bucket().list(`bills/${CASE}`, { limit: 1000 })).map((f) => f.name).sort();
  const adminId = (await seedE2eUser(db, ADMIN_EMAIL, ADMIN_PASSWORD)).id;
  const browser = await chromium.launch();
  try {
    must(await db.from("profiles").update({ role: "admin" }).eq("id", adminId));
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
    await admin.goto("/bills", { timeout: 90_000 });
    assert.equal(await admin.locator(`a[data-testid="send-notice"][href="/bills/${id}/notice"]`).count(), 1, "list link");
    assert.equal(await admin.locator(`a[href="/bills/${bare}/notice"]`).count(), 0);
    assert.ok((await admin.getByTestId("notice-blocked").count()) >= 1, "no-PDF row says why");
    await admin.goto(`/bills/${id}`, { timeout: 90_000 });
    assert.equal(await admin.getByTestId("bill-send-notice").innerText(), "Send 2nd notice");
    await admin.goto(`/bills/${bare}`);
    assert.match(await admin.getByTestId("bill-notice-blocked").innerText(), /no stored invoice PDF/);
    await admin.goto(`/bills/${id}/notice`, { timeout: 90_000 });
    await admin.getByLabel(/^to$/i).waitFor({ timeout: 60_000 });
    assert.equal(await admin.locator('[name="subject"]').inputValue(), "Re: Notice Caption v. Nobody");
    assert.match(await admin.locator('textarea[name="body"]').inputValue(), /^Dear Atty\. .*past due in the subject matter\.\n\nPlease contact us/s);
    assert.equal(await admin.getByRole("button", { name: /^send$/i }).isDisabled(), true, "Send disabled without keys");
    const pdf = await admin.request.get(`/bills/${id}/notice/pdf`);
    assert.equal(pdf.status(), 200);
    assert.equal(pdf.headers()["content-type"], "application/pdf");
    const body = Buffer.from(await pdf.body());
    assert.ok(body.equals(Buffer.from(await stampNotice(await download(b0.billpdfpath), "2nd"))), "preview = stored original + stamp");
    assert.equal((await admin.request.get(`/bills/${bare}/notice/pdf`)).status(), 404);
    assert.deepEqual(must(await bucket().list(`bills/${CASE}`, { limit: 1000 })).map((f) => f.name).sort(), keysBefore, "viewing never saves");

    const staff = await signIn(process.env.E2E_EMAIL ?? "staff@example.test", process.env.E2E_PASSWORD ?? "password");
    await staff.goto("/bills", { timeout: 90_000 });
    assert.equal(await staff.getByTestId("send-notice").count(), 0);
    await staff.goto(`/bills/${id}/notice`);
    assert.equal(await staff.getByRole("button", { name: /^send$/i }).count(), 0, "no Send for staff");
    assert.equal(await staff.getByText("Only admins can send bills.").count(), 1);
    assert.equal(noticeCols(await read(id)), noticeCols(b0));
  } finally {
    await browser.close();
    await db.from("profiles").delete().eq("id", adminId);
    await db.auth.admin.deleteUser(adminId);
  }
});
