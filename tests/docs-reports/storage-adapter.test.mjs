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

// --- attempt-2 review findings -------------------------------------------------

// A misconfigured bucket must read as "storage is broken", not "this document does not
// exist". Supabase answers 404 for a missing bucket too, so statusCode cannot discriminate.
// The local stack only emits NoSuchBucket on upload (createSignedUrl answers NoSuchKey for
// a bad bucket), so this drives putFile, with fetch rewriting the bucket segment of the URL.
test("live: a missing BUCKET is StorageOperationError, never StorageObjectNotFoundError", { skip }, async () => {
  const realFetch = globalThis.fetch;
  let sawRewrite = false;
  globalThis.fetch = (input, init) => {
    const href = typeof input === "string" ? input : input.url ?? String(input);
    const rewritten = href.replace(`/${STORAGE_BUCKET}/`, "/no-such-bucket-attempt2/");
    if (rewritten !== href) sawRewrite = true;
    return realFetch(rewritten, init);
  };
  try {
    const a = getStorageAdapter();
    const err = await a.putFile(key, BYTES, "application/octet-stream").then(() => null, (e) => e);
    assert.ok(sawRewrite, "fetch rewrite never fired — the test did not reach a bad bucket");
    assert.ok(err, "expected an error from a nonexistent bucket");
    assert.equal(err.name, "StorageOperationError", `got ${err.name}: ${err.message}`);
    assert.ok(!(err instanceof StorageObjectNotFoundError), "a missing bucket must not read as a missing object");
    assert.match(err.message, /Bucket not found/);
    console.log("missing bucket ->", err.name + ": " + err.message);
  } finally {
    globalThis.fetch = realFetch;
  }
});

// A page of list() is capped, so a case with more documents than one page silently
// returned a short list. Every document on a legal case file must come back.
test("live: listKeys pages past the list() page cap — 105 objects all come back", { skip }, async () => {
  const a = getStorageAdapter();
  const PAGED_CASE = 90002;
  const prefix = `cases/${PAGED_CASE}`;
  const names = Array.from({ length: 105 }, (_, i) => `${prefix}/${DOC_ID}-${String(i).padStart(3, "0")}`);
  const { createClient } = await import("@supabase/supabase-js");
  const raw = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
  try {
    for (const n of names) await a.putFile(n, BYTES, "application/octet-stream");
    const keys = await a.listKeys(prefix);
    assert.equal(keys.length, names.length, `expected ${names.length} keys, got ${keys.length}`);
    assert.deepEqual([...keys].sort(), [...names].sort());
    // every returned key is still a full, signable key
    assert.equal((await fetch(await a.getSignedUrl(keys[0], 60))).status, 200);
  } finally {
    const { error } = await raw.storage.from(STORAGE_BUCKET).remove(names);
    assert.equal(error, null, `cleanup failed: ${error?.message}`);
  }
});

// A caller-chosen TTL is clamped here — this adapter is the one place that bounds
// the lifetime of every signed URL it hands out, for every future caller.
test("live: an oversized caller TTL is clamped to the 15-minute ceiling", { skip }, async () => {
  const a = getStorageAdapter();
  await a.putFile(key, BYTES, "application/octet-stream");
  const signed = await a.getSignedUrl(key, 86_400);
  const token = new URL(signed).searchParams.get("token");
  const claims = JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString());
  const lifetime = claims.exp - Math.floor(Date.now() / 1000);
  assert.ok(lifetime <= 900, `signed URL lifetime ${lifetime}s exceeds the 900s ceiling`);
  console.log("clamped TTL ->", lifetime, "s for a requested 86400s");
});
