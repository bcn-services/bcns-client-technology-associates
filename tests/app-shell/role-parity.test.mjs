/**
 * middleware.ts re-implements the "which profiles row counts as a session" rule
 * inline, because it cannot import lib/auth/session.ts (that module binds to
 * next/headers). Nothing else pins the two together, and drift would make the
 * gate MORE permissive than getSession(). This test drives both off the same
 * fake profile row so a divergence fails the suite.
 *
 * lib/auth/session.ts is a protected contract: read here, never edited.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { NextRequest, NextResponse } from "next/server";
import { gate } from "../../middleware.ts";
import { getSession } from "../../lib/auth/session.ts";

const USER = { id: "00000000-0000-4000-8000-000000000001", email: "staff@example.test" };

const fakeClient = (profile) => ({
  auth: { getUser: async () => ({ data: { user: USER } }) },
  from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: profile }) }) }) }),
});

const gateAllows = async (profile) => {
  const request = new NextRequest(new Request("http://localhost:3100/cases/90001"));
  const res = await gate(request, () => ({
    client: fakeClient(profile),
    response: () => NextResponse.next(),
  }));
  return res.headers.get("location") === null;
};

const PROFILES = [
  { role: "staff", personid: 1 },
  { role: "admin", personid: null },
  { role: "client", personid: 1 },
  { role: "STAFF", personid: 1 },
  { role: "staff ", personid: 1 },
  { role: "", personid: 1 },
  { role: null, personid: 1 },
  { personid: 1 },
  {},
  null,
];

test("the gate's role check admits exactly what getSession() admits", async () => {
  for (const profile of PROFILES) {
    const label = JSON.stringify(profile);
    const allowed = await gateAllows(profile);
    const session = await getSession(fakeClient(profile));
    assert.equal(allowed, session !== null, `middleware and getSession disagree on ${label}`);
  }
});

test("at least one profile is admitted and one rejected, so parity is not vacuous", async () => {
  assert.equal(await gateAllows({ role: "staff", personid: 1 }), true);
  assert.equal(await gateAllows({ role: "client", personid: 1 }), false);
});
