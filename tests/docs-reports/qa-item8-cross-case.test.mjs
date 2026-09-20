// QA (LANE item 8): independent live proof that a case's documents panel and the
// direct-key download path cannot reach ANOTHER REAL CASE's document. The engineer's
// own live test compares against a case id that does not exist in the seeded stack,
// so this one seeds a real second case and a real second object.
import test from "node:test";
import assert from "node:assert/strict";

const live =
  process.env.DOCS_REPORTS_LOCAL_STACK && process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY
    ? false
    : "local Supabase stack not configured (source .env.test.local)";

const SESSION = { userId: "qa1", email: "staff@example.test", role: "staff", personId: 1 };
const CASE_A = 90001;
// NOT 90002: tests/docs-reports/storage-adapter.test.mjs asserts an exact object count under `cases/90002`.
const CASE_B = 90003;

test("live: two real cases — neither case can reach the other's document by id, key or list", { skip: live }, async () => {
  const { createCaseDocument, listCaseDocuments, listAllDocuments, loadDocument, documentDownloadUrl, DocumentError } =
    await import("../../lib/documents/store.ts");
  const { getStorageAdapter } = await import("../../lib/storage.ts");
  const { createServerClient } = await import("../../lib/db/client.ts");
  const db = createServerClient();
  const storage = getStorageAdapter();
  assert.notEqual(storage, null, "local stack must have a storage adapter");
  const code = (fn) => fn().then(() => null, (e) => (e instanceof DocumentError ? e.code : `not a DocumentError: ${e}`));

  // A real second case, so the cross-case check is not against a phantom id.
  const mk = await db.from("tblcase").upsert({
    caseid: CASE_B, caseatty: 1, casetitle: "QA Cross Case", caseclient: 1,
    tabranch: "Hartford", status: "Active", casestartdate: "2026-01-10", billingalert: false,
  }).select("caseid");
  assert.equal(mk.error, null, `seed case ${CASE_B}: ${mk.error?.message}`);

  const stamp = `${process.pid}-${Date.now()}`;
  const bytesA = new TextEncoder().encode(`case A secret ${stamp} é ✓\u0000binary`);
  const bytesB = new TextEncoder().encode(`case B secret ${stamp} — must never reach case A`);
  let a, b;
  try {
    a = await createCaseDocument(db, storage, SESSION, CASE_A, { name: "a.txt", type: "text/plain", bytes: bytesA }, "2026-02-01", `qa-a-${stamp}`);
    b = await createCaseDocument(db, storage, SESSION, CASE_B, { name: "b.txt", type: "text/plain", bytes: bytesB }, "2026-02-01", `qa-b-${stamp}`);

    // 1. Exactly one row per upload, with the right caseid.
    for (const [x, c] of [[a, CASE_A], [b, CASE_B]]) {
      const r = await db.from("tblscanneddocument").select("id, caseid, filename").eq("filename", x.key);
      assert.equal(r.error, null);
      assert.equal(r.data.length, 1, "exactly one row per upload");
      assert.equal(r.data[0].caseid, c);
    }

    // 2. Bytes round-trip identically through the signed URL (no public URL anywhere).
    for (const [x, want] of [[a, bytesA], [b, bytesB]]) {
      const url = await documentDownloadUrl(storage, await loadDocument(db, SESSION, x.id));
      assert.match(url, /\/storage\/v1\/object\/sign\/case-documents\//, "must be a signed URL, never object/public");
      const res = await fetch(url);
      assert.equal(res.status, 200);
      assert.deepEqual([...new Uint8Array(await res.arrayBuffer())], [...want], "downloaded bytes differ from uploaded");
    }

    // 3. THE guardrail: case A's panel asking for case B's document id gets nothing.
    assert.equal(await code(() => loadDocument(db, SESSION, b.id, CASE_A)), "notfound");
    assert.equal(await code(() => loadDocument(db, SESSION, a.id, CASE_B)), "notfound");

    // 4. Each case's list is that case's rows only.
    const listA = await listCaseDocuments(db, SESSION, CASE_A);
    assert.ok(listA.every((r) => r.caseid === CASE_A), "case A list leaked a foreign row");
    assert.ok(listA.some((r) => r.id === a.id));
    assert.ok(!listA.some((r) => r.id === b.id), "case B's document appeared in case A's panel");

    // 5. A session is required on every path, before any adapter call.
    assert.equal(await code(() => listCaseDocuments(db, null, CASE_A)), "auth");
    assert.equal(await code(() => loadDocument(db, null, a.id)), "auth");
    assert.equal(await code(() => listAllDocuments(db, null)), "auth");
    assert.equal(await code(() => createCaseDocument(db, storage, null, CASE_A, { name: "x", type: "text/plain", bytes: bytesA }, "2026-02-01", "nope")), "auth");
    const orphan = await db.from("tblscanneddocument").select("id").eq("filename", "cases/90001/nope");
    assert.equal(orphan.data.length, 0, "an unauthenticated upload still wrote a row");

    // 6. /documents index carries a caseid on every row it can link.
    const all = await listAllDocuments(db, SESSION);
    assert.equal(all.find((r) => r.id === a.id)?.caseid, CASE_A);
    assert.equal(all.find((r) => r.id === b.id)?.caseid, CASE_B);
  } finally {
    // The feature deliberately does not sweep objects; the test must, or it pollutes the bucket.
    const { createClient } = await import("@supabase/supabase-js");
    const raw = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
    await raw.storage.from("case-documents").remove([a, b].filter(Boolean).map((x) => x.key));
    for (const x of [a, b]) if (x) await db.from("tblscanneddocument").delete().eq("id", x.id);
    await db.from("tblcase").delete().eq("caseid", CASE_B);
  }
});

test("live: a row pointing at a key with no object is a missing OBJECT (404), not a storage fault", { skip: live }, async () => {
  const { StorageObjectNotFoundError } = await import("../../lib/storage.ts");
  const { getStorageAdapter } = await import("../../lib/storage.ts");
  const err = await getStorageAdapter().getSignedUrl(`cases/90001/definitely-absent-${Date.now()}`, 120).then(() => null, (e) => e);
  assert.ok(err instanceof StorageObjectNotFoundError, `expected StorageObjectNotFoundError, got ${err?.name}: ${err?.message}`);
});
