import { test } from "node:test";
import assert from "node:assert/strict";
import { NextRequest, NextResponse } from "next/server";
import { gate, middleware, bindSupabase } from "../../middleware.ts";

// No Supabase config in this process → the real middleware must fail closed.
delete process.env.NEXT_PUBLIC_SUPABASE_URL;
delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

const req = (path) => new NextRequest(new Request(`http://localhost:3100${path}`));
const location = (res) => {
  const l = res.headers.get("location");
  return l && new URL(l).pathname + new URL(l).search;
};

// Same fake shape as tests/foundation/session.test.mjs.
const fakeBound = (user, profile, response) => () => ({
  client: {
    auth: { getUser: async () => ({ data: { user } }) },
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: profile }) }) }) }),
  },
  response: () => response,
});
const USER = { id: "00000000-0000-4000-8000-000000000001" };

test("protected path redirects to /login?next=<encoded pathname+search>", async () => {
  const res = await middleware(req("/cases/90001"));
  assert.equal(res.status, 307);
  assert.equal(location(res), "/login?next=%2Fcases%2F90001");
});

test("query string is carried into next", async () => {
  const res = await middleware(req("/cases?tab=open"));
  assert.equal(location(res), "/login?next=%2Fcases%3Ftab%3Dopen");
});

test("/login and /api/health are not redirected", async () => {
  for (const path of ["/login", "/api/health"]) {
    const res = await middleware(req(path));
    assert.equal(res.headers.get("location"), null, path);
    assert.equal(res.status, 200, path);
  }
});

test("no Supabase config on a protected path fails closed", async () => {
  assert.equal(bindSupabase(req("/cases/90001")), null);
  assert.equal(location(await middleware(req("/dashboard"))), "/login?next=%2Fdashboard");
});

test("valid session with a profiles row reaches the page, carrying refreshed cookies", async () => {
  const refreshed = NextResponse.next();
  refreshed.cookies.set("sb-access-token", "refreshed");
  const res = await gate(req("/cases/90001"), fakeBound(USER, { role: "staff" }, refreshed));
  assert.equal(res.headers.get("location"), null);
  assert.equal(res.cookies.get("sb-access-token").value, "refreshed");
});

test("auth user without a profiles row is denied (mirrors getSession)", async () => {
  const res = await gate(req("/cases/90001"), fakeBound(USER, null, NextResponse.next()));
  assert.equal(location(res), "/login?next=%2Fcases%2F90001");
});

test("profile with a non-staff role is denied", async () => {
  const res = await gate(req("/cases/90001"), fakeBound(USER, { role: "client" }, NextResponse.next()));
  assert.equal(location(res), "/login?next=%2Fcases%2F90001");
});

test("a throwing client fails closed rather than falling through", async () => {
  const res = await gate(req("/cases/90001"), () => {
    throw new Error("network down");
  });
  assert.equal(location(res), "/login?next=%2Fcases%2F90001");
});

test("a protocol-relative path gets no next parameter at all", async () => {
  for (const path of ["//evil.com", "//evil.com/x", "/\\evil.com"]) {
    const request = req(path);
    assert.match(request.nextUrl.pathname, /^\/\//, `${path} did not produce a protocol-relative pathname`);
    const res = await middleware(request);
    assert.equal(location(res), "/login", path);
  }
});

test("a denial preserves cookies the session lookup rotated", async () => {
  const rotated = NextResponse.next();
  rotated.cookies.set("sb-refresh-token", "rotated");
  // Profile miss after a token rotation: the browser must still get the new token.
  const res = await gate(req("/cases/90001"), fakeBound(USER, null, rotated));
  assert.equal(location(res), "/login?next=%2Fcases%2F90001");
  assert.equal(res.cookies.get("sb-refresh-token").value, "rotated");
});

test("a hung Supabase denies instead of stalling the request", async () => {
  const hang = new Promise(() => {});
  const res = await gate(req("/cases/90001"), () => ({
    client: { auth: { getUser: () => hang }, from: () => ({}) },
    response: () => NextResponse.next(),
  }));
  assert.equal(location(res), "/login?next=%2Fcases%2F90001");
});

test("a hung profiles query denies too", async () => {
  const res = await gate(req("/cases/90001"), () => ({
    client: {
      auth: { getUser: async () => ({ data: { user: USER } }) },
      from: () => ({ select: () => ({ eq: () => ({ maybeSingle: () => new Promise(() => {}) }) }) }),
    },
    response: () => NextResponse.next(),
  }));
  assert.equal(location(res), "/login?next=%2Fcases%2F90001");
});
