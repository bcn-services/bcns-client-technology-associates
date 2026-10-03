// The acting user's id travels middleware.ts → request header → createServerClient() →
// PostgREST (x-app-actor), where migration 0010 records it as audit_log.actor.
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { AsyncLocalStorage } from "node:async_hooks";
import { NextRequest, NextResponse } from "next/server";
import { ACTOR_HEADER } from "../../lib/db/actor.ts";
import { gate } from "../../middleware.ts";

// The Next server installs this global before its request store is created; do the same
// so next/headers works here exactly as in a server action or route handler.
globalThis.AsyncLocalStorage ??= AsyncLocalStorage;
const { requestAsyncStorage } = await import("next/dist/client/components/request-async-storage.external.js");
const { createServerClient, requestActor } = await import("../../lib/db/client.ts");

const USER = "00000000-0000-4000-8000-000000000001";
const SPOOF = "99999999-9999-4999-8999-999999999999";

let sent; // headers of every outgoing fetch
const realFetch = globalThis.fetch;
const saved = {};
beforeEach(() => {
  sent = [];
  globalThis.fetch = async (_url, init) => {
    sent.push(new Headers(init?.headers));
    return new Response("[]", { status: 201, headers: { "content-type": "application/json" } });
  };
  for (const k of ["NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"]) saved[k] = process.env[k];
  process.env.NEXT_PUBLIC_SUPABASE_URL = "http://supabase.invalid";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-test";
});
afterEach(() => {
  globalThis.fetch = realFetch;
  for (const [k, v] of Object.entries(saved)) if (v === undefined) delete process.env[k]; else process.env[k] = v;
});

const write = (db) => db.from("tblexpenses").insert({ expid: 1 });

test("inside a request, createServerClient() sends the middleware-set actor on writes", async () => {
  const store = { headers: new Headers({ [ACTOR_HEADER]: USER }) };
  await requestAsyncStorage.run(store, () => write(createServerClient()));
  assert.equal(sent.length, 1);
  assert.equal(sent[0].get(ACTOR_HEADER), USER);
});

test("inside a request without the header (public path), no actor is sent", async () => {
  await requestAsyncStorage.run({ headers: new Headers() }, () => write(createServerClient()));
  assert.equal(sent[0].get(ACTOR_HEADER), null);
});

test("outside a request (scripts/migrate), no actor and no throw", async () => {
  assert.equal(requestActor(), null);
  await write(createServerClient());
  assert.equal(sent[0].get(ACTOR_HEADER), null);
});

const fakeBound = (user, profile) => () => ({
  client: {
    auth: { getUser: async () => ({ data: { user } }) },
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: profile }) }) }) }),
  },
  response: () => NextResponse.next(),
});
const req = (path, headers = {}) => new NextRequest(new Request(`http://localhost:3100${path}`, { headers }));
const forwarded = (res) => res.headers.get(`x-middleware-request-${ACTOR_HEADER}`);

test("middleware forwards the verified user id, replacing a client-sent spoof", async () => {
  const res = await gate(req("/cases/1", { [ACTOR_HEADER]: SPOOF }), fakeBound({ id: USER }, { role: "staff" }));
  assert.equal(res.headers.get("location"), null);
  assert.equal(forwarded(res), USER);
});

test("middleware strips a client-sent actor on public paths", async () => {
  const res = await gate(req("/login", { [ACTOR_HEADER]: SPOOF }), fakeBound(null, null));
  assert.equal(forwarded(res), null);
  // No override list would mean Next forwards the original headers, spoof included.
  const overrides = res.headers.get("x-middleware-override-headers");
  assert.ok(overrides !== null, "public path must forward an explicit header set");
  assert.ok(!overrides.split(",").includes(ACTOR_HEADER));
});
