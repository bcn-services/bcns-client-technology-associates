// The direct-key download path (LANE item 8 guardrails). Pure unit: the three seams
// (@/lib/auth/session, @/lib/db/client, @/lib/storage) are stubbed at the CJS resolver.
import test from "node:test";
import assert from "node:assert/strict";
import Module from "node:module";
import { readFileSync } from "node:fs";
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
  delete process.env.LEGACY_DOCS_DIR; // each test opts in to the NAS copy
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

test("a legacy NAS scan is 404 with the NAS message and the adapter is never reached", async () => {
  let reached = false;
  setup({ adapter: { getSignedUrl: async () => { reached = true; return SIGNED; } } });
  dbclient.state.db = fakeDb({ tblscanneddocument: [{ id: 5, caseid: 101, dateadded: "2026-01-02", type: null, description: null, filename: "img-121210115543.pdf" }] });
  for (const qs of ["", "?case=101"]) {
    const res = await get(5, qs);
    assert.equal(res.status, 404);
    assert.match(await res.text(), /office NAS/);
  }
  assert.equal(reached, false);
  // with no storage configured it is still the NAS message, not the 503 configuration one
  setup({ adapter: null });
  dbclient.state.db = fakeDb({ tblscanneddocument: [{ id: 5, caseid: 101, dateadded: "2026-01-02", type: null, description: null, filename: "img-1.pdf" }] });
  assert.equal((await get(5)).status, 404);
});

// ---- legacy NAS files served from $LEGACY_DOCS_DIR (fixtures: tests/docs-reports/fixtures/legacy-docs) ----
const LEGACY_DIR = fileURLToPath(new URL("./fixtures/legacy-docs", import.meta.url));
const SCAN_BYTES = readFileSync(`${LEGACY_DIR}/ScannedDocs/img-120124111506.pdf`);
const legacyRow = (over = {}) => ({ id: 5, caseid: 101, dateadded: "2026-01-02", type: null, description: null, filename: "img-120124111506.pdf", ...over });
function legacySetup(rows = [legacyRow()], opts) {
  let reached = false;
  setup({ ...opts, adapter: { getSignedUrl: async () => { reached = true; return SIGNED; } } });
  dbclient.state.db = fakeDb({ tblscanneddocument: rows });
  process.env.LEGACY_DOCS_DIR = LEGACY_DIR;
  return () => reached;
}

test("a legacy scan under its own case streams the NAS copy: 200, the exact bytes, never a redirect", async (t) => {
  t.after(() => { delete process.env.LEGACY_DOCS_DIR; });
  const reached = legacySetup();
  const res = await get(5, "?case=101");
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("content-type"), "application/pdf");
  assert.match(res.headers.get("content-disposition"), /^inline;/);
  assert.equal(res.headers.get("cache-control"), "private, no-store");
  assert.ok(!res.headers.get("location"));
  assert.deepEqual(Buffer.from(await res.arrayBuffer()), SCAN_BYTES);
  assert.equal((await get(5)).status, 200, "no ?case= scope is still authorized by the row's own case");
  assert.equal(reached(), false, "the storage adapter is never reached for a legacy row");
});

test("a legacy scan requested under ANOTHER case's scope is 404 with no file bytes", async (t) => {
  t.after(() => { delete process.env.LEGACY_DOCS_DIR; });
  legacySetup();
  for (const qs of ["?case=202", "?case=abc"]) {
    const res = await get(5, qs);
    assert.equal(res.status, 404, qs);
    const body = await res.text();
    assert.equal(body, "That document is not available on this case.");
    assert.ok(!res.headers.get("content-disposition"));
  }
  assert.equal((await get(999, "?case=101")).status, 404);
});

test("a legacy scan: anonymous → the login redirect, never the file", async (t) => {
  t.after(() => { delete process.env.LEGACY_DOCS_DIR; });
  legacySetup([legacyRow()], { redirect: true });
  const e = await get(5, "?case=101").then((r) => r, (err) => err);
  assert.ok(e instanceof Error, "a Response was returned to an anonymous caller");
  assert.equal(e.digest, "NEXT_REDIRECT;/login");
});

test("a legacy scan with the directory unset is the NAS note; with the file missing from the copy it is not-found", async (t) => {
  t.after(() => { delete process.env.LEGACY_DOCS_DIR; });
  legacySetup();
  delete process.env.LEGACY_DOCS_DIR;
  const unset = await get(5, "?case=101");
  assert.equal(unset.status, 404);
  assert.match(await unset.text(), /office NAS/);
  legacySetup([legacyRow({ filename: "img-missing-from-copy.pdf" })]);
  const gone = await get(5, "?case=101");
  assert.equal(gone.status, 404);
  assert.equal(await gone.text(), "That document is not available on this case.");
});

test("a legacy name that tries to leave the folder is not-found, not a file", async (t) => {
  t.after(() => { delete process.env.LEGACY_DOCS_DIR; });
  legacySetup([legacyRow({ filename: "../outside/secret.txt" })]);
  const res = await get(5, "?case=101");
  assert.equal(res.status, 404);
  assert.equal(await res.text(), "That document is not available on this case.");
});
