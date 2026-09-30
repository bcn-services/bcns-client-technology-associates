/**
 * QA value-add tests for the hosted-web template.
 * Complements the ai-optin/health/webhooks suites. Run with:
 *   corepack pnpm --filter @bcn-services/hosted-web-template test
 *
 * Covers:
 *  - env module: safe defaults when NO keys are set (never throws, all undefined)
 *  - env module: empty/whitespace values treated as unset
 *  - AI opt-in control case: flag ON + key present DOES invoke the injected factory
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { getConfig } from "../lib/env.ts";
import { maybeGetAiClient } from "../lib/ai.ts";

test("env: getConfig returns safe defaults when no keys are set (no throw)", () => {
  // Snapshot and clear every env var the config reads, then restore.
  const keys = [
    "DATABASE_URL",
    "NEXT_PUBLIC_SUPABASE_URL",
    "NEXT_PUBLIC_SUPABASE_ANON_KEY",
    "SUPABASE_SERVICE_ROLE_KEY",
    "ANTHROPIC_API_KEY",
    "AI_ENABLED",
  ];
  const saved = {};
  for (const k of keys) {
    saved[k] = process.env[k];
    delete process.env[k];
  }
  try {
    let cfg;
    assert.doesNotThrow(() => {
      cfg = getConfig();
    }, "getConfig must not throw when no env vars are set");
    assert.equal(cfg.databaseUrl, undefined);
    assert.equal(cfg.supabaseUrl, undefined);
    assert.equal(cfg.supabaseAnonKey, undefined);
    assert.equal(cfg.supabaseServiceRoleKey, undefined);
    assert.equal(cfg.anthropicApiKey, undefined);
    assert.equal(cfg.aiEnabled, false, "AI defaults OFF when AI_ENABLED unset");
  } finally {
    for (const k of keys) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  }
});

test("env: empty/whitespace values are treated as unset", () => {
  const saved = process.env.SUPABASE_SERVICE_ROLE_KEY;
  process.env.SUPABASE_SERVICE_ROLE_KEY = "   ";
  try {
    assert.equal(
      getConfig().supabaseServiceRoleKey,
      undefined,
      "whitespace-only -> undefined",
    );
  } finally {
    if (saved === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    else process.env.SUPABASE_SERVICE_ROLE_KEY = saved;
  }
});

test("AI control case: flag ON + key present invokes the injected factory once", () => {
  const calls = [];
  const createClient = (cfg) => {
    calls.push(cfg);
    return { __qaMock: true };
  };
  const config = { aiEnabled: true, anthropicApiKey: "sk-ant-qa-fake" };
  const client = maybeGetAiClient({ createClient, config });
  assert.equal(calls.length, 1, "opt-in path must invoke the injected factory");
  assert.equal(calls[0].apiKey, "sk-ant-qa-fake", "factory receives the configured key");
  assert.deepEqual(client, { __qaMock: true });
});
