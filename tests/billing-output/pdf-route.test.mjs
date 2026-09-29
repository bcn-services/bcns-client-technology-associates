// Item 4: GET /bills/[id]/pdf. The three seams (@/lib/auth/session, @/lib/db/client, @/lib/storage) are stubbed at
// the CJS resolver with the docs-reports stubs (imported, not edited), and fetch is faked. Synthetic data only.
import test from "node:test";
import assert from "node:assert/strict";
import Module from "node:module";
import { fileURLToPath } from "node:url";
import session from "../docs-reports/stub-session.cjs";
import dbclient from "../docs-reports/stub-dbclient.cjs";
import storage from "../docs-reports/stub-storage.cjs";

const here = (f) => fileURLToPath(new URL(f, import.meta.url));
const STUBS = { "@/lib/auth/session": here("../docs-reports/stub-session.cjs"), "@/lib/db/client": here("../docs-reports/stub-dbclient.cjs"), "@/lib/storage": here("../docs-reports/stub-storage.cjs") };
const realResolve = Module._resolveFilename;
Module._resolveFilename = function (request, ...rest) { return STUBS[request] ?? realResolve.call(this, request, ...rest); };
const mod = await import("../../app/bills/[id]/pdf/route.ts");
const GET = (mod.default?.GET ? mod.default : mod).GET;

const PDF = Buffer.from("%PDF-1.7\n% synthetic\n");
const KEY = "bills/992320/Bill992320 Testwood 2026 09 07-0.pdf";
const rowDb = (row) => ({ from: () => { const q = { select: () => q, eq: () => q, maybeSingle: async () => ({ data: row, error: null }) }; return q; } });
let fetched = [];
globalThis.fetch = async (u) => { fetched.push(u); return new Response(PDF, { status: 200 }); };
function setup({ row = { billpdfpath: KEY, billfilename: "x" }, adapter = { getSignedUrl: async (k, s) => `http://127.0.0.1:54421/sign/${encodeURIComponent(k)}?ttl=${s}` }, redirect = false } = {}) {
  dbclient.state.db = rowDb(row);
  storage.state.adapter = adapter;
  session.state.redirect = redirect;
  fetched = [];
}
const get = (id) => GET(new Request(`http://localhost:3150/bills/${id}/pdf`), { params: { id: String(id) } });

test("anonymous → the app's login redirect, never the file", async () => {
  setup({ redirect: true });
  const e = await get(810).then((r) => r, (err) => err);
  assert.ok(e instanceof Error, "a Response was returned to an anonymous caller");
  assert.equal(e.digest, "NEXT_REDIRECT;/login");
  assert.equal(fetched.length, 0);
});

test("signed-in user → the stored bytes as application/pdf", async () => {
  setup();
  const res = await get(810);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("content-type"), "application/pdf");
  assert.match(res.headers.get("content-disposition"), /filename="Bill992320 Testwood 2026 09 07-0\.pdf"/);
  assert.deepEqual(Buffer.from(await res.arrayBuffer()), PDF);
  assert.equal(fetched.length, 1);
});

test("no PDF yet / bad id → 404; storage unconfigured or failing → 503; missing object → 404", async () => {
  setup({ row: { billpdfpath: null } });
  assert.equal((await get(810)).status, 404);
  setup({ row: null });
  assert.equal((await get(810)).status, 404);
  setup();
  assert.equal((await get("81x")).status, 404);
  setup({ adapter: null });
  assert.equal((await get(810)).status, 503);
  const orig = console.error; console.error = () => {};
  try {
    setup({ adapter: { getSignedUrl: async (k) => { throw new storage.StorageObjectNotFoundError(k); } } });
    assert.equal((await get(810)).status, 404);
    setup({ adapter: { getSignedUrl: async () => { throw new Error("backend down"); } } });
    assert.equal((await get(810)).status, 503);
  } finally { console.error = orig; }
});
