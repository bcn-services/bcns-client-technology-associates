/**
 * QA live check of item 5 Send against the LOCAL Supabase stack (real DB + real storage), in-process runSend with the
 * production readStoredFile, RESEND_API_URL pointed at a Resend stub on a random port (the real API is never called).
 * Own invented case 993772 (copy of fixture case 90001's row); its bills, lines and bills/993772 objects are removed
 * before and after (try/finally via after()).
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { loadEnvLocal } from "../app-shell/seed-e2e.ts";
import { createServerClient } from "../../lib/db/client.ts";

loadEnvLocal();
const { getStorageAdapter } = await import("../../lib/storage.ts");
const { saveInvoicePdf } = await import("../../lib/bill-docs/invoice.ts");
const { readStoredFile } = await import("../../lib/bill-docs/send.ts");
const { runSend } = await import("../../lib/bills/send.ts");

const skip = process.env.SUPABASE_SERVICE_ROLE_KEY ? false : "Supabase unavailable";
const CASE = 993772;
let db, stub, stubUrl, hits = [], answer = () => [200, { id: "qa-live" }];
const must = ({ data, error }) => { if (error) throw new Error(error.message); return data; };
const bucket = () => db.storage.from("case-documents");
async function wipe() {
  const keys = (must(await bucket().list(`bills/${CASE}`, { limit: 1000 })) ?? []).map((f) => `bills/${CASE}/${f.name}`);
  if (keys.length) must(await bucket().remove(keys));
  const ids = must(await db.from("tblbills").select("billid").eq("billcaseid", CASE)).map((b) => b.billid);
  if (ids.length) must(await db.from("tblbilllines").delete().in("billid", ids));
  must(await db.from("tblbills").delete().eq("billcaseid", CASE));
  must(await db.from("tblcase").delete().eq("caseid", CASE));
}
const read = async (id) => must(await db.from("tblbills").select("*").eq("billid", id).single());
async function makeBill() {
  const id = must(await db.from("tblbills").insert({
    billcaseid: CASE, billdate: "2026-09-12", billhours: 0, billbalance: "750.00", billtype: "retainer", billnotice: "1st",
    billfinalizedat: new Date().toISOString(),
  }).select("billid").single()).billid;
  must(await db.from("tblbilllines").insert({ billid: id, lineno: 1, kind: "charge", linedate: "2026-09-12", description: "QA advance", amount: "750.00" }));
  await saveInvoicePdf(db, getStorageAdapter(), id, {});
  return id;
}
const fd = (b, o = {}) => {
  const f = new FormData();
  for (const [k, v] of Object.entries({ token: randomUUID(), sentat: b.billsentat ?? "", to: "qa-to@example.test", cc: "", bcc: "", subject: "Re: QA", body: "QA body", ...o })) f.set(k, v);
  return f;
};
async function act(id, f) {
  const out = { url: null, state: null };
  try {
    out.state = await runSend(id, f, {
      session: async () => ({ userId: "qa", email: "qa@example.test", role: "admin", personId: null }),
      db: () => db, now: () => new Date(),
      config: () => ({ apiKey: "re_test_stub", apiUrl: stubUrl, from: "bills@example.test" }),
      readPdf: (k) => readStoredFile(getStorageAdapter(), k),
      revalidatePath: () => {},
      redirect: (u) => { out.url = u; throw new Error("NEXT_REDIRECT"); },
    });
  } catch (e) { if (e.message !== "NEXT_REDIRECT") throw e; }
  return out;
}

before(async () => {
  if (skip) return;
  db = createServerClient();
  await wipe();
  const src = must(await db.from("tblcase").select("*").eq("caseid", 90001).single());
  must(await db.from("tblcase").insert({ ...src, caseid: CASE, casecaption: "QA Caption v. Nobody", billingalert: false, billingcc: null }));
  stub = createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => { raw += c; });
    req.on("end", () => {
      hits.push({ path: req.url, body: JSON.parse(raw || "{}") });
      const [s, j] = answer();
      res.writeHead(s, { "content-type": "application/json" }).end(JSON.stringify(j));
    });
  });
  await new Promise((r) => stub.listen(0, "127.0.0.1", r));
  stubUrl = `http://127.0.0.1:${stub.address().port}`;
});
after(async () => { stub?.close(); if (db) await wipe(); });

test("QA live: edited fields + attachment bytes == stored object; two concurrent previews → one provider call", { skip }, async () => {
  hits = []; answer = () => [200, { id: "qa-live" }];
  const id = await makeBill();
  const b0 = await read(id);
  const [r1, r2] = await Promise.all([
    act(id, fd(b0, { to: "one@example.test", cc: "cc-one@example.test", subject: "Re: EDIT one", body: "Body one" })),
    act(id, fd(b0, { to: "two@example.test", cc: "cc-two@example.test", subject: "Re: EDIT two", body: "Body two" })),
  ]);
  assert.equal(hits.length, 1, JSON.stringify([r1.state, r2.state]));
  assert.equal([r1.url, r2.url].filter(Boolean).length, 1);
  const h = hits[0];
  const won = h.body.to[0] === "one@example.test" ? "one" : "two";
  assert.deepEqual([h.body.to, h.body.cc, h.body.subject, h.body.text], [[`${won}@example.test`], [`cc-${won}@example.test`], `Re: EDIT ${won}`, `Body ${won}`]);
  const stored = Buffer.from(await must(await bucket().download(b0.billpdfpath)).arrayBuffer());
  assert.ok(Buffer.from(h.body.attachments[0].content, "base64").equals(stored), "attachment == stored object");
  const b1 = await read(id);
  assert.ok(b1.billsentat, "billsentat set");
  assert.equal(b1.billsentto, `${won}@example.test`);
});

test("QA live: Resend 500 → noanswer (item 6 spec change: may have been sent), bill not marked sent, provider message kept", { skip }, async () => {
  hits = []; answer = () => [500, { statusCode: 500, name: "internal_server_error", message: "QA stub exploded" }];
  const id = await makeBill();
  const b0 = await read(id);
  const r = await act(id, fd(b0));
  assert.equal(r.url, null);
  assert.equal(r.state?.code, "noanswer");
  assert.match(r.state.message, /500 QA stub exploded/);
  const b1 = await read(id);
  assert.deepEqual([b1.billsentat, b1.billsentto], [null, null]);
  assert.equal(hits.length, 1);
});
