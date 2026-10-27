// Legacy NAS files behind the bill and service-authorization downloads (GET /bills/[id]/pdf and
// GET /cases/service-auths/pdf/[srvauthid]). Same seams as document-download-route.test.mjs: session, db client and
// storage are stubbed at the CJS resolver; the NAS copy is tests/docs-reports/fixtures/legacy-docs (synthetic files).
import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import Module from "node:module";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import session from "./stub-session.cjs";
import dbclient from "./stub-dbclient.cjs";
import storage from "./stub-storage.cjs";

const here = (f) => fileURLToPath(new URL(f, import.meta.url));
const STUBS = { "@/lib/auth/session": here("./stub-session.cjs"), "@/lib/db/client": here("./stub-dbclient.cjs"), "@/lib/storage": here("./stub-storage.cjs") };
const realResolve = Module._resolveFilename;
Module._resolveFilename = function (request, ...rest) { return STUBS[request] ?? realResolve.call(this, request, ...rest); };

const bill = await import("../../app/bills/[id]/pdf/route.ts");
const sa = await import("../../app/cases/service-auths/pdf/[srvauthid]/route.ts");
const BILL_GET = (bill.default?.GET ? bill.default : bill).GET;
const SA_GET = (sa.default?.GET ? sa.default : sa).GET;

const DIR = here("./fixtures/legacy-docs");
const BILL_FILE = "Bill9001 Doe 2023 08 11-0";
const SA_FILE = "SA9002 Roe 2015 03 06-0";
const bytes = (rel) => readFileSync(`${DIR}/${rel}`);

const rowDb = (row) => ({ from: () => { const q = { select: () => q, eq: () => q, maybeSingle: async () => ({ data: row, error: null }) }; return q; } });
let fetched = [];
globalThis.fetch = async (u) => { fetched.push(String(u)); return new Response("stored pdf bytes", { status: 200 }); };

function setup({ row, dir = DIR, redirect = false, adapter = { getSignedUrl: async (k) => `https://storage.test/${k}` } }) {
  dbclient.state.db = rowDb(row);
  storage.state.adapter = adapter;
  session.state.redirect = redirect;
  fetched = [];
  if (dir) process.env.LEGACY_DOCS_DIR = dir; else delete process.env.LEGACY_DOCS_DIR;
}
afterEach(() => { delete process.env.LEGACY_DOCS_DIR; });
const billGet = () => BILL_GET(new Request("http://localhost:3150/bills/810/pdf"), { params: { id: "810" } });
const saGet = () => SA_GET(new Request("http://localhost:3150/cases/service-auths/pdf/901"), { params: { srvauthid: "901" } });
const anon = (p) => p.then((r) => r, (err) => err);

// ---- bills ----

test("bill: an unreadable NAS file is a 503 (a fault), never the 'not available' 404", { skip: process.getuid?.() === 0 && "root reads everything" }, async () => {
  const tmp = mkdtempSync(`${tmpdir()}/legacy-route-`);
  try {
    mkdirSync(`${tmp}/Bills`);
    writeFileSync(`${tmp}/Bills/Locked.pdf`, "x\n");
    chmodSync(`${tmp}/Bills/Locked.pdf`, 0o000);
    setup({ row: { billpdfpath: null, billfilename: "Locked" }, dir: tmp });
    const res = await billGet();
    assert.equal(res.status, 503);
    assert.equal(await res.text(), "The PDF could not be loaded.");
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("bill: no stored PDF + a legacy name → the NAS Word file streams as a download, and storage is never touched", async () => {
  setup({ row: { billpdfpath: null, billfilename: BILL_FILE } });
  const res = await billGet();
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("content-type"), "application/msword");
  assert.match(res.headers.get("content-disposition"), /^attachment; filename="Bill9001 Doe 2023 08 11-0\.doc"$/);
  assert.equal(res.headers.get("cache-control"), "private, no-store");
  assert.deepEqual(Buffer.from(await res.arrayBuffer()), bytes("Bills/Bill9001 Doe 2023 08 11-0.doc"));
  assert.deepEqual(fetched, []);
});

test("bill: a pdf export on the NAS opens inline", async () => {
  setup({ row: { billpdfpath: null, billfilename: "BillBoth" } });
  const res = await billGet();
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("content-type"), "application/pdf");
  assert.match(res.headers.get("content-disposition"), /^inline;/);
  assert.deepEqual(Buffer.from(await res.arrayBuffer()), bytes("Bills/BillBoth.pdf"));
});

test("bill: a name missing from the NAS copy is a 'not available' 404; an unsafe name is too; no directory or no name is 'no PDF yet'", async () => {
  setup({ row: { billpdfpath: null, billfilename: "Bill9999 Nobody" } });
  const gone = await billGet();
  assert.equal(gone.status, 404);
  assert.equal(await gone.text(), "That bill's file is not available.");
  setup({ row: { billpdfpath: null, billfilename: "../outside/secret.txt" } });
  assert.equal(await (await billGet()).text(), "That bill's file is not available.");
  setup({ row: { billpdfpath: null, billfilename: BILL_FILE }, dir: null });
  assert.equal(await (await billGet()).text(), "This bill has no PDF yet.");
  setup({ row: { billpdfpath: null, billfilename: null } });
  assert.equal(await (await billGet()).text(), "This bill has no PDF yet.");
});

test("bill: a stored PDF still wins over a legacy name", async () => {
  setup({ row: { billpdfpath: "bills/810/Bill810 X-0.pdf", billfilename: BILL_FILE } });
  const res = await billGet();
  assert.equal(res.headers.get("content-type"), "application/pdf");
  assert.equal(await res.text(), "stored pdf bytes");
  assert.equal(fetched.length, 1);
});

test("bill: anonymous → the login redirect, never the NAS file", async () => {
  setup({ row: { billpdfpath: null, billfilename: BILL_FILE }, redirect: true });
  const e = await anon(billGet());
  assert.ok(e instanceof Error, "a Response was returned to an anonymous caller");
  assert.equal(e.digest, "NEXT_REDIRECT;/login");
});

// ---- service authorizations ----

test("sa: a row that is not an app-made SA streams the NAS .docx; storage is never touched", async () => {
  setup({ row: { srvauthcaseid: 55, srvauthfile: SA_FILE } });
  const res = await saGet();
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("content-type"), "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
  assert.match(res.headers.get("content-disposition"), /^attachment; filename="SA9002 Roe 2015 03 06-0\.docx"$/);
  assert.deepEqual(Buffer.from(await res.arrayBuffer()), bytes("ServAuth/SA9002 Roe 2015 03 06-0.docx"));
  assert.deepEqual(fetched, []);
});

test("sa: a legacy file that LOOKS app-made (SA<caseid> ..., -0) falls back to the NAS when storage has no such object", async () => {
  const missing = { getSignedUrl: async (k) => { throw new storage.StorageObjectNotFoundError(k); } };
  setup({ row: { srvauthcaseid: 9002, srvauthfile: SA_FILE }, adapter: missing });
  const res = await saGet();
  assert.equal(res.status, 200);
  assert.deepEqual(Buffer.from(await res.arrayBuffer()), bytes("ServAuth/SA9002 Roe 2015 03 06-0.docx"));
});

test("sa: an app-made SA is served from storage as before, the NAS copy untouched", async () => {
  setup({ row: { srvauthcaseid: 9002, srvauthfile: SA_FILE } });
  const res = await saGet();
  assert.equal(res.headers.get("content-type"), "application/pdf");
  assert.equal(await res.text(), "stored pdf bytes");
  assert.deepEqual(fetched, [`https://storage.test/service-auths/9002/${SA_FILE}.pdf`]);
});

test("sa: missing from the NAS copy is a 'not available' 404; no directory keeps the 'older files are on the office drive' note", async () => {
  setup({ row: { srvauthcaseid: 55, srvauthfile: "SA2001 Nobody 2001 01 01-0" } });
  const gone = await saGet();
  assert.equal(gone.status, 404);
  assert.equal(await gone.text(), "That service authorization's file is not available.");
  setup({ row: { srvauthcaseid: 55, srvauthfile: SA_FILE }, dir: null, adapter: { getSignedUrl: async (k) => { throw new storage.StorageObjectNotFoundError(k); } } });
  const unset = await saGet();
  assert.equal(unset.status, 404);
  assert.match(await unset.text(), /older files are on the office drive/);
  setup({ row: { srvauthcaseid: 55, srvauthfile: "../outside/secret.txt" } });
  assert.equal(await (await saGet()).text(), "That service authorization's file is not available.");
  setup({ row: null });
  assert.equal(await (await saGet()).text(), "This service authorization has no file.");
});

test("sa: anonymous → the login redirect, never the NAS file", async () => {
  setup({ row: { srvauthcaseid: 55, srvauthfile: SA_FILE }, redirect: true });
  const e = await anon(saGet());
  assert.ok(e instanceof Error, "a Response was returned to an anonymous caller");
  assert.equal(e.digest, "NEXT_REDIRECT;/login");
});
