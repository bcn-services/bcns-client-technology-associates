// Storage adapter (LANE item 7). The live half talks to the LOCAL Supabase stack only
// and self-skips without it; the unconfigured half always runs.
import test from "node:test";
import assert from "node:assert/strict";

const mod = await import("../../lib/storage.ts");
const { getStorageAdapter, STORAGE_BUCKET, StorageObjectNotFoundError } = mod;

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const skip = process.env.DOCS_REPORTS_LOCAL_STACK && url && process.env.SUPABASE_SERVICE_ROLE_KEY
  ? false
  : "local Supabase stack not configured (source .env.test.local)";

// Keys derive from canonical ids, never from user-supplied filename text.
const CASE_ID = 90001;
const DOC_ID = `doc-${process.pid}-${Date.now()}`;
const key = `cases/${CASE_ID}/${DOC_ID}`;
const BYTES = new TextEncoder().encode("case document bytes é ✓");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

test("unconfigured storage returns null instead of throwing, and a caller degrades", () => {
  const saved = { u: process.env.NEXT_PUBLIC_SUPABASE_URL, k: process.env.SUPABASE_SERVICE_ROLE_KEY };
  delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  try {
    const adapter = getStorageAdapter();
    assert.equal(adapter, null);
    // the documented caller shape: optional-chain off the seam, no throw, no file feature
    assert.equal(adapter?.getSignedUrl ? "enabled" : "disabled", "disabled");
  } finally {
    if (saved.u !== undefined) process.env.NEXT_PUBLIC_SUPABASE_URL = saved.u;
    if (saved.k !== undefined) process.env.SUPABASE_SERVICE_ROLE_KEY = saved.k;
  }
});

test("live: upload then fetch through the signed URL returns the same bytes", { skip }, async () => {
  const a = getStorageAdapter();
  assert.ok(a, "adapter should exist with local stack env");
  await a.putFile(key, BYTES, "application/octet-stream");
  const signed = await a.getSignedUrl(key, 60);
  assert.match(signed, /\/storage\/v1\/object\/sign\/case-documents\//);
  const res = await fetch(signed);
  assert.equal(res.status, 200);
  const got = new Uint8Array(await res.arrayBuffer());
  assert.deepEqual([...got], [...BYTES]);
});

test("live: the unsigned storage URL is rejected — the bucket is private", { skip }, async () => {
  const a = getStorageAdapter();
  await a.putFile(key, BYTES, "application/octet-stream");
  const res = await fetch(`${url}/storage/v1/object/public/${STORAGE_BUCKET}/${key}`);
  assert.ok(!res.ok, `public URL must not serve the object, got ${res.status}`);
  console.log("unsigned URL ->", res.status, await res.text());
});

test("live: an expired signed URL is rejected", { skip }, async () => {
  const a = getStorageAdapter();
  await a.putFile(key, BYTES, "application/octet-stream");
  const signed = await a.getSignedUrl(key, 1);
  await sleep(2100);
  const res = await fetch(signed);
  assert.ok(!res.ok, `expired signed URL must not serve the object, got ${res.status}`);
  console.log("expired URL ->", res.status, await res.text());
});

test("live: a signed URL for a missing key is the defined error, not a 500", { skip }, async () => {
  const a = getStorageAdapter();
  const missing = `cases/${CASE_ID}/does-not-exist-${DOC_ID}`;
  const err = await a.getSignedUrl(missing, 60).then(() => null, (e) => e);
  assert.ok(err instanceof StorageObjectNotFoundError, `expected StorageObjectNotFoundError, got ${err}`);
  assert.match(err.message, /does-not-exist/);
  console.log("missing key ->", err.name + ": " + err.message);
});

test("live: listKeys returns prefixed keys that getSignedUrl accepts", { skip }, async () => {
  const a = getStorageAdapter();
  await a.putFile(key, BYTES, "application/octet-stream");
  const keys = await a.listKeys(`cases/${CASE_ID}`);
  assert.ok(keys.includes(key), `expected ${key} in ${JSON.stringify(keys.slice(0, 5))}`);
  const signed = await a.getSignedUrl(keys[keys.indexOf(key)], 60);
  assert.equal((await fetch(signed)).status, 200);
});
