/**
 * Import-boundary test: proves the AI module does NOT invoke the Anthropic
 * client factory when the AI_ENABLED flag is off. Run with:
 *   corepack pnpm --filter @nseluga/hosted-web-template test
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { maybeGetAiClient, isAiEnabled } from "../lib/ai.ts";

/** A spy factory that records whether it was ever called. */
function makeSpy() {
  const calls = [];
  const createClient = (cfg) => {
    calls.push(cfg);
    return { __mock: true };
  };
  return { calls, createClient };
}

test("flag OFF: createAnthropicClient is never called", () => {
  const { calls, createClient } = makeSpy();
  const config = { aiEnabled: false, anthropicApiKey: "sk-ant-should-not-be-read" };
  const client = maybeGetAiClient({ createClient, config });
  assert.equal(client, null, "no client when flag off");
  assert.equal(calls.length, 0, "factory must not be invoked when flag off");
});

test("flag OFF with key present: still no invocation", () => {
  const { calls, createClient } = makeSpy();
  const config = { aiEnabled: false, anthropicApiKey: "sk-ant-xyz" };
  maybeGetAiClient({ createClient, config });
  assert.equal(calls.length, 0);
});

test("flag ON but no key: factory not called, returns null", () => {
  const { calls, createClient } = makeSpy();
  const config = { aiEnabled: true, anthropicApiKey: undefined };
  const client = maybeGetAiClient({ createClient, config });
  assert.equal(client, null);
  assert.equal(calls.length, 0, "no key means no client construction");
});

test("flag ON with key: factory IS called once (control case)", () => {
  const { calls, createClient } = makeSpy();
  const config = { aiEnabled: true, anthropicApiKey: "sk-ant-xyz" };
  const client = maybeGetAiClient({ createClient, config });
  assert.equal(calls.length, 1, "opt-in path invokes the factory");
  assert.deepEqual(client, { __mock: true });
});

test("isAiEnabled reflects the flag", () => {
  assert.equal(isAiEnabled({ config: { aiEnabled: false } }), false);
  assert.equal(isAiEnabled({ config: { aiEnabled: true } }), true);
});
