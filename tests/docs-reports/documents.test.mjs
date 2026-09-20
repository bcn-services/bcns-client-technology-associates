// Case documents (LANE item 8). Unit half always runs against the fake; the live half
// talks to the LOCAL Supabase stack only and self-skips without it.
import test from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import Module from "node:module";
import { fileURLToPath } from "node:url";
import { fakeDb } from "./fakedb.mjs";

// The panel's client child cannot run under react-dom/server outside Next; swap it at the CJS resolver.
const realResolve = Module._resolveFilename;
Module._resolveFilename = function (request, ...rest) {
  return request === "./upload-form" ? fileURLToPath(new URL("./stub-upload-form.cjs", import.meta.url)) : realResolve.call(this, request, ...rest);
};

const store = await import("../../lib/documents/store.ts");
const {
  assertDocumentAccess, createCaseDocument, documentDownloadUrl, documentErrorMessage,
  documentKey, listAllDocuments, listCaseDocuments, loadDocument, DocumentError, MAX_UPLOAD_BYTES,
} = store;
const panel = await import("../../app/documents/case-panel.tsx");
const { CaseDocumentsPanelView } = panel.default?.CaseDocumentsPanelView ? panel.default : panel;

globalThis.React = React;

const SESSION = { userId: "u1", email: "kris@example.test", role: "staff", personId: 1 };
const code = (fn) => fn().then(() => null, (e) => (e instanceof DocumentError ? e.code : `not a DocumentError: ${e}`));

const seeded = () => fakeDb({
  tblscanneddocument: [
    { id: 1, caseid: 101, dateadded: "2026-01-02", type: "application/pdf", description: "complaint.pdf", filename: "cases/101/aaa" },
    { id: 2, caseid: 202, dateadded: "2026-01-03", type: "image/png", description: "scene.png", filename: "cases/202/bbb" },
    { id: 3, caseid: 101, dateadded: "2026-01-04", type: "text/plain", description: "note.txt", filename: "cases/101/ccc" },
  ],
});

// --- the one shared rule -----------------------------------------------------

test("no session is refused on every path, before any adapter call", async () => {
  assert.throws(() => assertDocumentAccess(null, 101), (e) => e.code === "auth");
  assert.equal(await code(() => listCaseDocuments(seeded(), null, 101)), "auth");
  assert.equal(await code(() => listAllDocuments(seeded(), null)), "auth");
  assert.equal(await code(() => loadDocument(seeded(), null, 1)), "auth");
  const db = seeded();
  assert.equal(await code(() => createCaseDocument(db, { putFile: () => { throw new Error("adapter must not be reached"); } }, null, 101, { name: "x", type: "text/plain", bytes: new Uint8Array([1]) }, "2026-01-01", "tok")), "auth");
  assert.equal(db.writes, 0);
});

test("scope can only narrow access, never grant it", () => {
  assert.equal(assertDocumentAccess(SESSION, 101, 101), 101);
  assert.equal(assertDocumentAccess(SESSION, 101, null), 101);
  assert.throws(() => assertDocumentAccess(SESSION, 101, 202), (e) => e.code === "notfound");
  assert.throws(() => assertDocumentAccess(SESSION, null), (e) => e.code === "notfound");
});

// --- listing path ------------------------------------------------------------

test("a case's list is that case's rows only", async () => {
  const rows = await listCaseDocuments(seeded(), SESSION, 101);
  assert.deepEqual(rows.map((r) => r.id).sort(), [1, 3]);
  assert.ok(rows.every((r) => r.caseid === 101));
  assert.deepEqual(await listCaseDocuments(seeded(), SESSION, 999), []);
});

test("a row the query filter let through is still dropped by the list's own re-check", async () => {
  // A db whose .eq() is a no-op — stands in for a driver, view or policy that ignored the filter.
  const leaky = { from: () => { const b = { select: () => b, eq: () => b, order: () => b, then: (r) => r({ data: seeded().tables.tblscanneddocument, error: null }) }; return b; } };
  const rows = await listCaseDocuments(leaky, SESSION, 101);
  assert.deepEqual(rows.map((r) => r.id).sort(), [1, 3], "another case's row reached the panel");
});

test("a read error is an error, never a silently empty list", async () => {
  const broken = { from: () => { const b = { select: () => b, eq: () => b, order: () => b, limit: () => b, then: (r) => r({ data: null, error: { message: "boom" } }) }; return b; } };
  await assert.rejects(() => listCaseDocuments(broken, SESSION, 101), /tblscanneddocument case read: boom/);
});

// --- direct-key path ---------------------------------------------------------

test("a direct-key download re-derives the caseid from the row, and a foreign id under a case scope is refused", async () => {
  const mine = await loadDocument(seeded(), SESSION, 1, 101);
  assert.equal(mine.caseid, 101);
  assert.equal(mine.filename, "cases/101/aaa");
  // doc 2 belongs to case 202: requesting it from case 101's panel must not resolve
  assert.equal(await code(() => loadDocument(seeded(), SESSION, 2, 101)), "notfound");
  assert.equal(await code(() => loadDocument(seeded(), SESSION, 99, 101)), "notfound");
  assert.equal(await code(() => loadDocument(seeded(), SESSION, 0)), "notfound");
});

test("storage being unconfigured is reported as a configuration fault, not a missing document", async () => {
  const doc = await loadDocument(seeded(), SESSION, 1, 101);
  assert.equal(await code(() => documentDownloadUrl(null, doc)), "storage");
  assert.notEqual(documentErrorMessage("storage"), documentErrorMessage("notfound"));
  assert.match(documentErrorMessage("storage"), /configuration/i);
});

// --- upload ------------------------------------------------------------------

test("upload writes the bytes then exactly one row, keyed off the case id", async () => {
  const db = seeded();
  const put = [];
  const storage = { async putFile(key, bytes, ct) { put.push({ key, bytes, ct }); } };
  const bytes = new TextEncoder().encode("hello é");
  const { id, key } = await createCaseDocument(db, storage, SESSION, 101, { name: "hi.txt", type: "text/plain", bytes }, "2026-02-01", "tok-1");
  assert.equal(key, documentKey(101, "tok-1"));
  assert.equal(put.length, 1);
  assert.deepEqual([...put[0].bytes], [...bytes]);
  const rows = db.tables.tblscanneddocument.filter((r) => r.id === id);
  assert.equal(rows.length, 1);
  assert.deepEqual(rows[0], { id, caseid: 101, dateadded: "2026-02-01", type: "text/plain", description: "hi.txt", filename: "cases/101/tok-1" });
  assert.equal(db.writes, 1);
  // the key never contains the name the user typed
  assert.ok(!key.includes("hi.txt"));
});

test("an empty, oversized or storage-less upload writes no row at all", async () => {
  const bad = { putFile: () => { throw new Error("adapter must not be reached"); } };
  for (const [file, want] of [
    [{ name: "e", type: "text/plain", bytes: new Uint8Array(0) }, "input"],
    [{ name: "b", type: "text/plain", bytes: new Uint8Array(MAX_UPLOAD_BYTES + 1) }, "toolarge"],
  ]) {
    const db = seeded();
    assert.equal(await code(() => createCaseDocument(db, bad, SESSION, 101, file, "2026-02-01", "t")), want);
    assert.equal(db.writes, 0);
  }
  const db = seeded();
  assert.equal(await code(() => createCaseDocument(db, null, SESSION, 101, { name: "a", type: "text/plain", bytes: new Uint8Array([1]) }, "2026-02-01", "t")), "storage");
  assert.equal(db.writes, 0);
});

test("a failed putFile leaves no row behind", async () => {
  const db = seeded();
  const storage = { async putFile() { throw new Error("bucket gone"); } };
  await assert.rejects(() => createCaseDocument(db, storage, SESSION, 101, { name: "a", type: "text/plain", bytes: new Uint8Array([1]) }, "2026-02-01", "t"), /bucket gone/);
  assert.equal(db.writes, 0);
});

// --- the case-page panel -----------------------------------------------------

const render = (props) => renderToStaticMarkup(CaseDocumentsPanelView(props));

test("the case panel renders that case's documents, each scoped to the case", async () => {
  const docs = await listCaseDocuments(seeded(), SESSION, 101);
  const html = render({ caseId: 101, docs, storageReady: true });
  assert.match(html, /complaint\.pdf/);
  assert.match(html, /note\.txt/);
  assert.doesNotMatch(html, /scene\.png/, "another case's document is on the panel");
  assert.match(html, /href="\/documents\/1\/download\?case=101"/);
  assert.doesNotMatch(html, /storage\/v1\/object/, "a raw storage URL was rendered");
});

test("an empty panel distinguishes 'no documents' from 'storage is not configured'", () => {
  assert.match(render({ caseId: 101, docs: [], storageReady: true }), /No documents on this case/);
  const broken = render({ caseId: 101, docs: [], storageReady: false });
  assert.match(broken, /storage is not configured/i);
  assert.match(render({ caseId: 101, docs: null, storageReady: true }), /could not be loaded/);
});

// --- live: the local stack ---------------------------------------------------

const live = process.env.DOCS_REPORTS_LOCAL_STACK && process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY
  ? false
  : "local Supabase stack not configured (source .env.test.local)";

test("live: upload against a case creates one row and the bytes come back identical", { skip: live }, async () => {
  const { getStorageAdapter } = await import("../../lib/storage.ts");
  const { createServerClient } = await import("../../lib/db/client.ts");
  const db = createServerClient();
  const cases = await db.from("tblcase").select("caseid").order("caseid", { ascending: true }).limit(2);
  assert.equal(cases.error, null);
  const caseId = cases.data[0].caseid;
  const other = cases.data[1]?.caseid ?? caseId + 1;

  const bytes = new TextEncoder().encode(`live doc ${process.pid} é ✓`);
  const token = `t-${process.pid}-${Date.now()}`;
  const { id, key } = await createCaseDocument(db, getStorageAdapter(), SESSION, caseId, { name: "live.txt", type: "text/plain", bytes }, "2026-02-01", token);
  // Sweep both halves whatever happens below: a leftover object under this prefix
  // breaks any later test that counts objects there.
  try {

  const rows = await db.from("tblscanneddocument").select("id, caseid, filename, description").eq("filename", key);
  assert.equal(rows.error, null);
  assert.equal(rows.data.length, 1, "exactly one row per upload");
  assert.equal(rows.data[0].caseid, caseId);

  const doc = await loadDocument(db, SESSION, id, caseId);
  const url = await documentDownloadUrl(getStorageAdapter(), doc);
  assert.match(url, /\/storage\/v1\/object\/sign\/case-documents\//);
  const res = await fetch(url);
  assert.equal(res.status, 200);
  assert.deepEqual([...new Uint8Array(await res.arrayBuffer())], [...bytes], "downloaded bytes differ from uploaded");

  // the same id under another case's scope resolves to nothing
  assert.equal(await code(() => loadDocument(db, SESSION, id, other)), "notfound");

  // the case list contains it, and every row in it belongs to this case
  const list = await listCaseDocuments(db, SESSION, caseId);
  assert.ok(list.some((r) => r.id === id));
  assert.ok(list.every((r) => r.caseid === caseId));
  } finally {
    await db.from("tblscanneddocument").delete().eq("id", id);
    await db.storage.from("case-documents").remove([key]);
  }
});

// A missing BUCKET and a missing OBJECT both come back from createSignedUrl as
// {"statusCode":"404","code":"NoSuchKey","message":"Object not found"}. Only the
// object case may become a 404 "not available on this case"; a bucket the app
// cannot see is a configuration fault (503), never a wrong answer about the case.
test("live: a missing bucket is a storage fault, a missing key is a missing object", { skip: live }, async () => {
  const { getStorageAdapter, StorageObjectNotFoundError } = await import("../../lib/storage.ts");
  const realFetch = globalThis.fetch;
  let missingBucket;
  globalThis.fetch = (u, o) => realFetch(String(u).replace("/case-documents", "/no-such-bucket-qa"), o);
  try {
    missingBucket = await getStorageAdapter().getSignedUrl("cases/90001/x", 60).then(() => null, (e) => e);
  } finally {
    globalThis.fetch = realFetch;
  }
  assert.ok(missingBucket, "a nonexistent bucket must not sign a URL");
  assert.equal(missingBucket.name, "StorageOperationError", `got ${missingBucket.name}: ${missingBucket.message}`);
  assert.ok(!(missingBucket instanceof StorageObjectNotFoundError), "a missing bucket must not read as a missing document");

  const missingKey = await getStorageAdapter().getSignedUrl(`cases/90001/no-such-object-${process.pid}`, 60).then(() => null, (e) => e);
  assert.ok(missingKey instanceof StorageObjectNotFoundError, `missing key in the real bucket must stay a missing object, got ${missingKey?.name}`);
});

test("live: a forged case scope never widens access to a real document", { skip: live }, async () => {
  const { createServerClient } = await import("../../lib/db/client.ts");
  const db = createServerClient();
  const r = await db.from("tblscanneddocument").select("id, caseid").not("caseid", "is", null).limit(1);
  assert.equal(r.error, null);
  if (!r.data.length) return; // nothing uploaded yet in this stack
  const { id, caseid } = r.data[0];
  assert.equal((await loadDocument(db, SESSION, id, caseid)).id, id);
  assert.equal(await code(() => loadDocument(db, SESSION, id, caseid + 1)), "notfound");
});
