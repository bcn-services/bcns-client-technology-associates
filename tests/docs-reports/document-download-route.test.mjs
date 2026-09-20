// The direct-key download path (LANE item 8 guardrails). Pure unit: the three seams
// (@/lib/auth/session, @/lib/db/client, @/lib/storage) are stubbed at the CJS resolver.
import test from "node:test";
import assert from "node:assert/strict";
import Module from "node:module";
import { fileURLToPath } from "node:url";
import { fakeDb } from "./fakedb.mjs";
import session from "./stub-session.cjs";
import dbclient from "./stub-dbclient.cjs";
import storage from "./stub-storage.cjs";

const here = (f) => fileURLToPath(new URL(f, import.meta.url));
const STUBS = { "@/lib/auth/session": here("./stub-session.cjs"), "@/lib/db/client": here("./stub-dbclient.cjs"), "@/lib/storage": here("./stub-storage.cjs") };
const realResolve = Module._resolveFilename;
Module._resolveFilename = function (request, ...rest) { return STUBS[request] ?? realResolve.call(this, request, ...rest); };

const mod = await import("../../app/documents/[id]/download/route.ts");
const GET = (mod.default?.GET ? mod.default : mod).GET;

const DOCS = [
  { id: 1, caseid: 101, dateadded: "2026-01-02", type: "application/pdf", description: "complaint.pdf", filename: "cases/101/aaa" },
  { id: 2, caseid: 202, dateadded: "2026-01-03", type: "image/png", description: "scene.png", filename: "cases/202/bbb" },
];
const SIGNED = "http://127.0.0.1:54421/storage/v1/object/sign/case-documents/cases/101/aaa?token=x";

function setup({ adapter = { getSignedUrl: async () => SIGNED }, redirect = false } = {}) {
  dbclient.state.db = fakeDb({ tblscanneddocument: DOCS.map((d) => ({ ...d })) });
  storage.state.adapter = adapter;
  session.state.redirect = redirect;
}
const get = (id, qs = "") => GET(new Request(`http://localhost:3100/documents/${id}/download${qs}`), { params: { id: String(id) } });

test("an anonymous request gets the app's normal redirect, never a file", async () => {
  setup({ redirect: true });
  const e = await get(1).then((r) => r, (err) => err);
  assert.ok(e instanceof Error, "a Response was returned to an anonymous caller");
  assert.equal(e.digest, "NEXT_REDIRECT;/login");
});

test("an authorized document redirects to a short-lived SIGNED url", async () => {
  setup();
  const res = await get(1, "?case=101");
  assert.equal(res.status, 302);
  assert.equal(res.headers.get("location"), SIGNED);
  assert.match(res.headers.get("location"), /\/object\/sign\//);
  assert.doesNotMatch(res.headers.get("location"), /\/object\/public\//);
});

test("another case's document id, requested under this case's scope, is not served", async () => {
  setup();
  for (const qs of ["?case=101", "?case=abc", "?case=101.5"]) {
    const res = await get(2, qs);
    assert.equal(res.status, 404, `doc 2 served for ${qs}`);
    assert.ok(!res.headers.get("location"), "a location header leaked the file");
  }
  assert.equal((await get(999, "?case=101")).status, 404);
});

test("the caseid is re-derived from the row — a forged scope cannot widen access", async () => {
  setup();
  // doc 2 is case 202; asking for it with its OWN case works, with any other it does not
  assert.equal((await get(2, "?case=202")).status, 302);
  assert.equal((await get(2, "?case=999")).status, 404);
});

test("unconfigured storage is 503 with a configuration message, never 404 'no such document'", async () => {
  setup({ adapter: null });
  const res = await get(1, "?case=101");
  assert.equal(res.status, 503);
  assert.match(await res.text(), /configuration/i);
});

test("a storage backend fault is 503; only a missing object is 404", async () => {
  setup({ adapter: { getSignedUrl: async () => { throw new storage.StorageOperationError("cases/101/aaa", "NoSuchBucket"); } } });
  assert.equal((await get(1, "?case=101")).status, 503);
  setup({ adapter: { getSignedUrl: async () => { throw new storage.StorageObjectNotFoundError("cases/101/aaa"); } } });
  assert.equal((await get(1, "?case=101")).status, 404);
});
