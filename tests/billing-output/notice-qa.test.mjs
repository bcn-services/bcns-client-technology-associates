// Item 6 notice resend — independent QA (unit). Rasterizes the stamped PDF with poppler (pdftoppm / pdftotext /
// pdfimages) to check the stamp's real placement and that the original text survives; drives runSend(kind "notice")
// against an in-memory PostgREST fake and a LOCAL Resend stub on a random port (the real API is never called) for
// double / concurrent submits, failures, idempotency scopes and no-keys; the /bills list rule via the real
// loadOpenBills. Every name, figure and address is invented (@example.test).
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { randomUUID, createHash } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

globalThis.React = React;
const rdom = createRequire(import.meta.url)("react-dom");
rdom.useFormStatus = () => ({ pending: false });
rdom.useFormState = (_a, init) => [init, () => {}];
const { runSend, loadSend, noticeEmailDraft } = await import("../../lib/bills/send.ts");
const { stampNotice, noticeKey } = await import("../../lib/bill-docs/notice.ts");
const { sendWithGuard, SendError } = await import("../../lib/bill-docs/send.ts");
const { renderInvoice } = await import("../../lib/bill-docs/invoice.ts");
const { loadOpenBills } = await import("../../lib/bills/list.ts");
const { SendForm } = await import("../../app/bills/[id]/send/send-form.tsx");

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const poppler = spawnSync("pdftoppm", ["-v"]).status === 0 && spawnSync("pdftotext", ["-v"]).status === 0;
const noPoppler = poppler ? false : "poppler (pdftoppm/pdftotext/pdfimages) not installed";
const TMP = mkdtempSync(join(tmpdir(), "notice-qa-"));
const PNG = (n) => readFileSync(join(ROOT, `lib/bill-docs/stamps/${n}.png`));

// ---- an invented invoice from the real item-4 renderer; LONG has 2+ pages ----
const CASE = 994771, BID = 7711, KEY = `bills/${CASE}/Bill${CASE} Quillfeather 2026 07 01-0.pdf`;
const line = (i) => ({ kind: "charge", linedate: "2026-06-03", description: `Invented review item ${i}`, personid: null, hours: null, rate: null, amount: 1000 + i });
const invoice = (lines) => renderInvoice({
  bill: { billid: BID, billcaseid: CASE, billdate: "2026-07-01", billtype: "retainer", billhours: 0, billbalance: "99.00", billfinalizedat: "2026-07-01T10:00:00Z", billfilename: `Bill${CASE} Quillfeather 2026 07 01-0`, billpdfpath: KEY },
  casetitle: "Example v. Nobody", casecaption: "Court of Samples No. Q-7", address: ["Atty. Pat Quillfeather", "2 Example Lane", "Faketown ZZ 00002"], attyLastName: "Quillfeather", lines,
}, { letterhead: ["Invented Consulting Co."], taxId: "00-0000000" }).then((b) => Buffer.from(b));
const SHORT = await invoice([line(1), line(2)]);
const LONG = await invoice(Array.from({ length: 70 }, (_, i) => line(i)));

// ---- poppler helpers ----
let seq = 0;
const put = (bytes) => { const p = join(TMP, `f${seq++}.pdf`); writeFileSync(p, bytes); return p; };
function raster(bytes, page = 1) {
  const pdf = put(bytes), out = pdf.replace(/\.pdf$/, `-p${page}`);
  execFileSync("pdftoppm", ["-r", "72", "-f", String(page), "-l", String(page), "-singlefile", pdf, out]);
  const b = readFileSync(`${out}.ppm`);
  const parts = []; let i = 0;
  while (parts.length < 4) { let s = ""; while (!/\s/.test(String.fromCharCode(b[i]))) s += String.fromCharCode(b[i++]); i++; if (s) parts.push(s); }
  return { w: Number(parts[1]), h: Number(parts[2]), px: b.subarray(i) };
}
function diff(a, c) {
  assert.deepEqual([a.w, a.h], [c.w, c.h]);
  const bb = [Infinity, Infinity, -1, -1]; let n = 0, red = 0;
  for (let y = 0; y < a.h; y++) for (let x = 0; x < a.w; x++) {
    const k = (y * a.w + x) * 3;
    if (a.px[k] === c.px[k] && a.px[k + 1] === c.px[k + 1] && a.px[k + 2] === c.px[k + 2]) continue;
    n++; bb[0] = Math.min(bb[0], x); bb[1] = Math.min(bb[1], y); bb[2] = Math.max(bb[2], x); bb[3] = Math.max(bb[3], y);
    if (c.px[k] > 150 && c.px[k + 1] < 120 && c.px[k + 2] < 120) red++;
  }
  return { n, red, bb };
}
const pages = (bytes) => Number(execFileSync("pdfinfo", [put(bytes)]).toString().match(/Pages:\s+(\d+)/)[1]);
const text = (bytes) => execFileSync("pdftotext", ["-layout", put(bytes), "-"]).toString();
const images = (bytes) => execFileSync("pdfimages", ["-list", put(bytes)]).toString().split("\n").slice(2).filter(Boolean)
  .map((l) => l.trim().split(/\s+/)).map((c) => ({ page: Number(c[0]), type: c[2], w: Number(c[3]), h: Number(c[4]) }));

after(() => rmSync(TMP, { recursive: true, force: true }));

for (const [notice, word, other] of [["2nd", "SecondNotice", "FinalNotice"], ["Final", "FinalNotice", "SecondNotice"]]) {
  test(`QA6-1 ${notice}: rasterized page 1 changes ONLY inside the 120x35pt box at left 150 / top 250, in red; text identical; one image of ${word}.png's size; later pages untouched`, { skip: noPoppler }, async () => {
    for (const orig of [SHORT, LONG]) {
      const before = Buffer.from(orig);
      const out = Buffer.from(await stampNotice(orig, notice));
      assert.ok(orig.equals(before), "original bytes untouched by stamping");
      const d = diff(raster(orig), raster(out));
      assert.ok(d.n > 500, `stamp visible (${d.n} px changed)`);
      assert.ok(d.red > 200, `stamp is red (${d.red} px)`);
      // Pixel (x, y) from top-left at 72 dpi = points; anti-aliasing may touch the far edge pixel.
      assert.ok(d.bb[0] >= 149 && d.bb[1] >= 249 && d.bb[2] <= 271 && d.bb[3] <= 286, `changes outside the box: ${d.bb}`);
      assert.ok(d.bb[0] <= 152 && d.bb[1] <= 252 && d.bb[2] >= 266 && d.bb[3] >= 281, `stamp does not fill its box: ${d.bb}`);
      assert.equal(text(out), text(orig), "every original line still extracts, unchanged");
      assert.equal(pages(out), pages(orig));
      for (let p = 2; p <= pages(orig); p++) assert.equal(diff(raster(orig, p), raster(out, p)).n, 0, `page ${p} changed`);
      const imgs = images(out).filter((i) => i.type === "image");
      assert.deepEqual(imgs.map((i) => [i.page, i.w, i.h]), [[1, PNG(word).readUInt32BE(16), PNG(word).readUInt32BE(20)]], JSON.stringify(images(out)));
      assert.notDeepEqual([imgs[0].w, imgs[0].h], [PNG(other).readUInt32BE(16), PNG(other).readUInt32BE(20)]);
    }
    assert.equal(pages(LONG) > 1, true, "LONG fixture spans pages");
  });
}

test("QA6-2 2nd and Final stamps rasterize differently (right image per notice)", { skip: noPoppler }, async () => {
  const s = raster(Buffer.from(await stampNotice(SHORT, "2nd"))), f = raster(Buffer.from(await stampNotice(SHORT, "Final")));
  assert.ok(diff(s, f).n > 200);
});

test("QA6-3 stamping is byte-deterministic across processes and time (a retry keeps its Idempotency-Key)", async () => {
  const src = put(SHORT);
  const script = join(TMP, "stamp.mts");
  writeFileSync(script, `import { readFileSync } from "node:fs"; import { createHash } from "node:crypto";
const { stampNotice } = await import(${JSON.stringify(join(ROOT, "lib/bill-docs/notice.ts"))});
for (const n of ["2nd", "Final"]) console.log(createHash("sha256").update(await stampNotice(readFileSync(${JSON.stringify(src)}), n)).digest("hex"));`);
  await new Promise((r) => setTimeout(r, 1100)); // a different second than this process's stamping
  const r = spawnSync(join(ROOT, "node_modules/.bin/tsx"), [script], { cwd: ROOT, encoding: "utf8", env: { ...process.env, TZ: "Pacific/Kiritimati" } });
  assert.equal(r.status, 0, r.stderr);
  const here = [];
  for (const n of ["2nd", "Final"]) here.push(createHash("sha256").update(await stampNotice(SHORT, n)).digest("hex"));
  assert.deepEqual(r.stdout.trim().split("\n"), here);
  assert.notEqual(here[0], here[1]);
});

// ---- runSend(kind "notice") harness ----
/** PostgREST-shaped fake: eq / is / in filters; update(...).select() → updated rows; `failUpdate(n)` errors the n-th update. */
function memDb(tables, { failUpdate = () => false } = {}) {
  const writes = []; let updates = 0;
  return {
    tables, writes,
    from(table) {
      const st = { f: [], upd: null, one: false };
      const chain = new Proxy({}, {
        get(_, k) {
          if (k === "then") {
            if (st.upd && failUpdate(++updates, st.upd)) return (ok, bad) => Promise.resolve({ data: null, error: { message: "injected update error" } }).then(ok, bad);
            const rows = (tables[table] ??= []).filter((r) => st.f.every((fn) => fn(r)));
            if (st.upd) { for (const r of rows) Object.assign(r, st.upd); writes.push([table, { ...st.upd }, rows.length]); }
            const data = st.one ? (rows[0] ? { ...rows[0] } : null) : rows.map((r) => ({ ...r }));
            return (ok, bad) => Promise.resolve({ data, error: null }).then(ok, bad);
          }
          return (...a) => {
            if (k === "eq") st.f.push((r) => r[a[0]] === a[1]);
            else if (k === "is") st.f.push((r) => (r[a[0]] ?? null) === a[1]);
            else if (k === "in") st.f.push((r) => a[1].includes(r[a[0]]));
            else if (k === "update") st.upd = a[0];
            else if (k === "maybeSingle" || k === "single") st.one = true;
            return chain;
          };
        },
      });
      return chain;
    },
  };
}

let stub, stubUrl, hits = [], answer = () => [200, { id: "qa6-stub" }], delay = 0;
before(async () => {
  stub = createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => { raw += c; });
    req.on("end", async () => {
      hits.push({ headers: req.headers, body: JSON.parse(raw || "{}") });
      if (delay) await new Promise((r) => setTimeout(r, delay));
      const [s, j] = answer();
      res.writeHead(s, { "content-type": "application/json" }).end(JSON.stringify(j));
    });
  });
  await new Promise((r) => stub.listen(0, "127.0.0.1", r));
  stubUrl = `http://127.0.0.1:${stub.address().port}`;
});
after(() => stub?.close());
const reset = () => { hits = []; answer = () => [200, { id: "qa6-stub" }]; delay = 0; };

const SENT0 = "2026-08-01T09:00:00.000+00:00";
const billRow = (o = {}) => ({
  billid: BID, billcaseid: CASE, billdate: "2026-07-01", billhours: 0, billbalance: "20.03", billnotice: "2nd", billtype: "retainer",
  billfinalizedat: "2026-07-01T10:00:00.000+00:00", supersedesbillid: null, billfilename: `Bill${CASE} Quillfeather 2026 07 01-0`,
  billpdfpath: KEY, billsentat: SENT0, billsentto: "quill@example.test", billsecondnoticedate: "2026-08-05", billfinalnoticedate: null, ...o,
});
const world = (bill = {}, opts) => memDb({
  tblbills: [billRow(bill)],
  tblcase: [{ caseid: CASE, casetitle: "Example v. Nobody", casecaption: "Court of Samples No. Q-7", caseatty: 77, billingalert: false, billingcc: "clerk@example.test" }],
  tblattorney: [{ attyid: 77, attyemail: "quill@example.test", attylastname: "Quillfeather" }],
  tblbilllines: [1, 2].map((i) => ({ billid: BID, lineno: i, ...line(i), amount: (line(i).amount / 100).toFixed(2) })),
}, opts);
const PROTECTED = ["billnotice", "billsecondnoticedate", "billfinalnoticedate", "billpdfpath", "billfinalizedat"];
const snap = (db) => JSON.stringify(PROTECTED.map((k) => db.tables.tblbills[0][k]));
async function formFor(db, o = {}) {
  const b = db.tables.tblbills[0];
  const draft = noticeEmailDraft(await loadSend(db, BID), "archive@example.test");
  const f = new FormData();
  for (const [k, v] of Object.entries({ token: randomUUID(), sentat: b.billsentat ?? "", notice: b.billnotice, ...draft, ...o })) f.set(k, v);
  return f;
}
async function act(db, f, o = {}) {
  const seen = { url: null, state: null, reads: [], writes: [] };
  try {
    seen.state = await runSend(BID, f, {
      session: async () => ({ userId: "qa6", email: "qa6@example.test", role: "admin", personId: null }),
      db: () => db,
      now: () => o.now ?? new Date("2026-09-30T15:00:00.000Z"),
      config: () => o.config ?? { apiKey: "re_test_stub", apiUrl: stubUrl, from: "bills@example.test" },
      readPdf: async (k) => { seen.reads.push(k); return new Uint8Array(SHORT); },
      writePdf: async (k, bytes) => { await new Promise((r) => setTimeout(r, 5)); seen.writes.push([k, Buffer.from(bytes)]); },
      revalidatePath: () => {},
      redirect: (u) => { seen.url = u; throw Object.assign(new Error("NEXT_REDIRECT"), { digest: "NEXT_REDIRECT" }); },
    }, "notice");
  } catch (e) { if (e.message !== "NEXT_REDIRECT") throw e; }
  return seen;
}

for (const [notice, word] of [["2nd", "SecondNotice"], ["Final", "FinalNotice"]]) {
  test(`QA6-4 ${notice}: double submit (same form twice) → ONE provider call; the second is stale and writes nothing`, async () => {
    reset();
    const db = world({ billnotice: notice, billfinalnoticedate: notice === "Final" ? "2026-09-04" : null });
    const before = snap(db);
    const f = await formFor(db);
    const r1 = await act(db, f), r2 = await act(db, f, { now: new Date("2026-09-30T15:00:01.000Z") });
    assert.equal(r1.url, `/bills/${BID}/notice?sent=1`, JSON.stringify(r1.state));
    assert.equal(r2.state?.code, "stale");
    assert.equal(hits.length, 1);
    assert.equal(r2.writes.length, 0, "stale resubmit saves no file");
    assert.equal(db.tables.tblbills[0].billsentat, "2026-09-30T15:00:00.000Z", "first send's stamp stands");
    assert.equal(snap(db), before, "billnotice / notice dates / pdf path byte-identical");
    assert.match(hits[0].headers["idempotency-key"], new RegExp(`^notice-${word}-${BID}-`));
  });

  test(`QA6-5 ${notice}: CONCURRENT double submit → ONE provider call, one stale; every saved file is the notice key with identical bytes (no conflicting files, original never written)`, async () => {
    reset();
    delay = 30;
    const db = world({ billnotice: notice });
    const f = await formFor(db);
    const [a, b] = await Promise.all([act(db, f), act(db, f, { now: new Date("2026-09-30T15:00:00.500Z") })]);
    assert.equal(hits.length, 1, "exactly one provider call");
    assert.deepEqual([a, b].map((r) => (r.url ? "sent" : r.state?.code)).sort(), ["sent", "stale"]);
    const writes = [...a.writes, ...b.writes];
    assert.ok(writes.length >= 1);
    assert.deepEqual([...new Set(writes.map((w) => w[0]))], [noticeKey(KEY, notice)]);
    assert.ok(writes.every((w) => w[1].equals(writes[0][1])), "both writers saved the same bytes");
    assert.ok(Buffer.from(hits[0].body.attachments[0].content, "base64").equals(writes[0][1]), "saved file == attachment");
    assert.equal(db.writes.filter(([, u, n]) => "billsentat" in u && n === 1).length, 1, "one claim landed");
  });
}

test("QA6-6 Resend refusal (422) on a notice → 'provider', nothing recorded: last-emailed restored, only billsentat/billsentto ever written, notice fields identical", async () => {
  reset();
  answer = () => [422, { statusCode: 422, name: "validation_error", message: "bad attachment" }];
  const db = world({ billnotice: "Final", billfinalnoticedate: "2026-09-04" });
  const b0 = { ...db.tables.tblbills[0] };
  const r = await act(db, await formFor(db));
  assert.equal(r.state?.code, "provider");
  assert.match(r.state.message, /Nothing was sent.*422 bad attachment/);
  assert.equal(hits.length, 1);
  assert.deepEqual(db.tables.tblbills[0], b0, "bill row identical to before");
  for (const [, u] of db.writes) assert.deepEqual(Object.keys(u).sort(), ["billsentat", "billsentto"]);
});

test("QA6-7 notice no-answer (503) then an unchanged resend → same Idempotency-Key (deduped by Resend), bill not marked sent in between", async () => {
  reset();
  answer = () => [503, { message: "try later" }];
  const db = world();
  const f = await formFor(db);
  const r1 = await act(db, f);
  assert.equal(r1.state?.code, "noanswer");
  assert.match(r1.state.message, /may have been sent.*503 try later/);
  assert.equal(db.tables.tblbills[0].billsentat, SENT0, "released");
  answer = () => [200, { id: "qa6-ok" }];
  const r2 = await act(db, await formFor(db), { now: new Date("2026-09-30T16:00:00.000Z") });
  assert.ok(r2.url, JSON.stringify(r2.state));
  assert.equal(hits.length, 2);
  assert.equal(hits[0].headers["idempotency-key"], hits[1].headers["idempotency-key"]);
});

test("QA6-8 idempotency scopes: invoice vs 2nd vs Final all differ at the same prior send, and no address (To/CC/BCC) appears in any key", async () => {
  reset();
  const keys = [];
  for (const [notice, kind] of [["2nd", "bill"], ["2nd", "notice"], ["Final", "notice"]]) {
    const db = world({ billnotice: notice });
    const f = await formFor(db, { to: "quill@example.test", cc: "clerk@example.test", bcc: "archive@example.test", subject: "Re: Same", body: "Same" });
    const r = kind === "bill"
      ? await (async () => { const s = { url: null }; try { await runSend(BID, f, { session: async () => ({ role: "admin" }), db: () => db, now: () => new Date(), config: () => ({ apiKey: "re_test_stub", apiUrl: stubUrl, from: "bills@example.test" }), readPdf: async () => new Uint8Array(SHORT), revalidatePath: () => {}, redirect: (u) => { s.url = u; throw new Error("NEXT_REDIRECT"); } }, "bill"); } catch (e) { if (e.message !== "NEXT_REDIRECT") throw e; } return s; })()
      : await act(db, f);
    assert.ok(r.url, kind);
    keys.push(hits.at(-1).headers["idempotency-key"]);
  }
  const scopes = keys.map((k) => k.slice(0, -33));
  assert.equal(new Set(scopes).size, 3, scopes.join(" | "));
  for (const k of keys) assert.doesNotMatch(k, /@|quill|clerk|archive|example/i);
});

test("QA6-9 notice no-answer whose release fails → 'noanswer-release' (may have been sent AND shows as sent)", async () => {
  reset();
  answer = () => [500, { message: "gone" }];
  const db = world({}, { failUpdate: (n) => n === 2 }); // 1 = claim, 2 = release
  const r = await act(db, await formFor(db));
  assert.equal(r.state?.code, "noanswer-release");
  assert.match(r.state.message, /may have been sent/);
  assert.match(r.state.message, /shows as sent/);
  assert.match(r.state.message, /500 gone/);
  assert.equal(hits.length, 1);
});

test("QA6-10 sendWithGuard status mapping: 4xx → provider, 409 / 500 / 502 / timeout-drop → noanswer; release failure → release vs noanswer-release", async () => {
  const cfg = { apiKey: "re_test_stub", apiUrl: "http://127.0.0.1:1", from: "bills@example.test" };
  const mail = { to: ["a@example.test"], cc: [], bcc: [], subject: "S", text: "B", attachment: { filename: "a.pdf", content: new Uint8Array([1]) } };
  const run = async (fetchFn, releaseOk = true) => {
    try { await sendWithGuard(cfg, mail, { claim: async () => true, release: async () => { if (!releaseOk) throw new Error("x"); } }, "qa", fetchFn); return "ok"; }
    catch (e) { assert.ok(e instanceof SendError, String(e)); return e.code; }
  };
  const st = (s) => async () => new Response(JSON.stringify({ message: "m" }), { status: s });
  const table = [[400, "provider"], [401, "provider"], [422, "provider"], [429, "provider"], [409, "noanswer"], [500, "noanswer"], [502, "noanswer"], [504, "noanswer"]];
  for (const [s, code] of table) assert.equal(await run(st(s)), code, String(s));
  assert.equal(await run(async () => { throw new TypeError("fetch failed"); }), "noanswer");
  assert.equal(await run(st(422), false), "release");
  assert.equal(await run(st(503), false), "noanswer-release");
  assert.equal(await run(async () => { throw new Error("socket hang up"); }, false), "noanswer-release");
});

test("QA6-11 no Resend keys: notice send refused 'email-off' before any read, write, DB or provider call; the preview form still renders with Send disabled and a plain message", async () => {
  reset();
  const db = world();
  const b0 = JSON.stringify(db.tables.tblbills);
  for (const config of [{ apiUrl: stubUrl }, { apiUrl: stubUrl, apiKey: "re_test_stub" }, { apiUrl: stubUrl, from: "bills@example.test" }]) {
    const r = await act(db, await formFor(db), { config });
    assert.equal(r.state?.code, "email-off");
    assert.match(r.state.message, /Email is not set up yet, so Send is turned off/);
    assert.deepEqual([r.reads.length, r.writes.length, db.writes.length, hits.length], [0, 0, 0, 0]);
  }
  assert.equal(JSON.stringify(db.tables.tblbills), b0);
  const html = renderToStaticMarkup(React.createElement(SendForm, {
    draft: noticeEmailDraft(await loadSend(db, BID), undefined), alert: false, emailOn: false, token: randomUUID(), sentat: SENT0, notice: "2nd",
    pdfHref: `/bills/${BID}/notice/pdf`, pdfName: "x SecondNotice.pdf", action: async () => null,
  }));
  assert.match(html, /<button(?=[^>]*\sdisabled="")[^>]*>Send<\/button>/, "Send disabled without keys");
  assert.match(html, /data-testid="send-off"[^>]*>Email is not set up yet, so Send is turned off\. The preview and the PDF still work\./);
  assert.match(html, /href="\/bills\/7711\/notice\/pdf"/);
  assert.match(html, /name="notice" value="2nd"/);
});

test("QA6-12 staff at the action: the admin session guard throws ForbiddenError → 'forbidden', no DB / PDF / provider", async () => {
  reset();
  const db = world();
  let dbCalls = 0;
  const f = await formFor(db);
  const r = await runSend(BID, f, {
    session: async () => { throw Object.assign(new Error("admin only"), { name: "ForbiddenError" }); },
    db: () => { dbCalls++; return db; }, now: () => new Date(),
    config: () => ({ apiKey: "re_test_stub", apiUrl: stubUrl, from: "bills@example.test" }),
    readPdf: async () => { throw new Error("read"); }, writePdf: async () => { throw new Error("write"); },
    revalidatePath: () => {}, redirect: () => { throw new Error("redirected"); },
  }, "notice");
  assert.equal(r?.code, "forbidden");
  assert.deepEqual([dbCalls, db.writes.length, hits.length], [0, 0, 0]);
});

test("QA6-13 /bills list rule (real loadOpenBills): 2nd/Final with stored PDF → sendNotice; no PDF → notice-nopdf; legacy → notice-legacy; 1st / Partial → neither", async () => {
  const b = (id, o) => billRow({ billid: id, billsecondnoticedate: null, ...o });
  const db = memDb({ tblbills: [
    b(1, { billnotice: "2nd" }), b(2, { billnotice: "Final" }), b(3, { billnotice: "2nd", billpdfpath: null }),
    b(4, { billnotice: "Final", billtype: null, billpdfpath: null, billfinalizedat: null }), b(5, { billnotice: "1st" }),
    b(6, { billnotice: "Partial Payment" }), b(7, { billnotice: "Final", billfinalizedat: null, billpdfpath: null }),
  ] });
  const rows = Object.fromEntries((await loadOpenBills(db, "2026-09-30")).flatMap((g) => g.rows).map((r) => [r.billid, [r.sendNotice, r.noticeWhy]]));
  assert.deepEqual(rows, {
    1: [true, null], 2: [true, null], 3: [false, "notice-nopdf"], 4: [false, "notice-legacy"], 5: [false, null], 6: [false, null], 7: [false, "notice-nopdf"],
  });
  assert.equal(db.writes.length, 0, "list is read-only");
});
