// The route adapter: reads config lazily, answers 401 without a valid signature (and with no env at all), touches no db on a reject.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { POST } from "../../app/api/tickets/inbound/route.ts";

const post = (body, headers = {}) => POST(new Request("http://localhost:3100/api/tickets/inbound", { method: "POST", body, headers }));

test("no env at all: any POST is 401 (fails closed), and importing the route read nothing", async () => {
  for (const k of ["TICKET_INBOUND_SECRET", "NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"]) delete process.env[k];
  assert.equal((await post("{}")).status, 401);
  const key = Buffer.alloc(0);
  const ts = String(Math.floor(Date.now() / 1000));
  const sig = `v1,${createHmac("sha256", key).update(`m.${ts}.{}`).digest("base64")}`;
  assert.equal((await post("{}", { "svix-id": "m", "svix-timestamp": ts, "svix-signature": sig })).status, 401);
});

test("secret set: a wrong signature is 401, a correct one on an ignorable event is 200 (no db or network)", async () => {
  const key = Buffer.from("route-test-key-0123456789");
  process.env.TICKET_INBOUND_SECRET = `whsec_${key.toString("base64")}`;
  try {
    const ts = String(Math.floor(Date.now() / 1000));
    const body = JSON.stringify({ type: "email.sent", data: {} });
    const sign = (k) => `v1,${createHmac("sha256", k).update(`m.${ts}.${body}`).digest("base64")}`;
    assert.equal((await post(body, { "svix-id": "m", "svix-timestamp": ts, "svix-signature": sign(Buffer.from("nope")) })).status, 401);
    const ok = await post(body, { "svix-id": "m", "svix-timestamp": ts, "svix-signature": sign(key) });
    assert.deepEqual([ok.status, await ok.text()], [200, "ignored: event type"]);
  } finally {
    delete process.env.TICKET_INBOUND_SECRET;
  }
});

test("logging: every outcome past the signature is logged with its note and email_id only; a bad signature is not, nor are the body or sender", async () => {
  const key = Buffer.from("route-test-key-0123456789");
  process.env.TICKET_INBOUND_SECRET = `whsec_${key.toString("base64")}`;
  const lines = [];
  const log = console.log;
  console.log = (...a) => lines.push(a.join(" "));
  try {
    const ts = String(Math.floor(Date.now() / 1000));
    const body = JSON.stringify({ type: "email.received", data: { email_id: "em_log1", from: "stranger@else.test", to: ["t1@x.test"], subject: "SECRET-SUBJECT" } });
    const sign = (k) => `v1,${createHmac("sha256", k).update(`m.${ts}.${body}`).digest("base64")}`;
    await post(body, { "svix-id": "m", "svix-timestamp": ts, "svix-signature": sign(Buffer.from("nope")) });
    assert.deepEqual(lines, [], "a bad signature is not logged");
    const ok = await post(body, { "svix-id": "m", "svix-timestamp": ts, "svix-signature": sign(key) });
    assert.equal(ok.status, 200);
    assert.deepEqual(lines, ["ticket inbound: 200 ignored: sender or recipient email_id=em_log1"]);
  } finally {
    console.log = log;
    delete process.env.TICKET_INBOUND_SECRET;
  }
});
