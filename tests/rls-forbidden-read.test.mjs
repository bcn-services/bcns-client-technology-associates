/**
 * RLS forbidden-read scaffold (template contract).
 *
 * Platform rule (hosting reference): "Write RLS policies from commit one and
 * add tests that attempt forbidden reads and must fail." This scaffold is the
 * standing home for those tests in every client repo.
 *
 * In the keyless template there is no schema yet, so the live probe SKIPS
 * unless Supabase env is configured. Client builds MUST extend this file with
 * one forbidden-read attempt per protected table/role as the schema lands
 * (e.g. anon reading another tenant's rows, a restricted role reading
 * owner-only data) — each attempt must come back empty or denied.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();
const configured = Boolean(url && anonKey);

test(
  "rls: anon key cannot read arbitrary tables without a policy",
  { skip: !configured && "Supabase env not configured — live RLS probe skipped" },
  async () => {
    // Probe a table name the schema should never expose publicly. With RLS on
    // and no anon policy, PostgREST answers with an error or an empty set —
    // never rows.
    const res = await fetch(`${url}/rest/v1/protected_probe?select=*`, {
      headers: { apikey: anonKey, Authorization: `Bearer ${anonKey}` },
    });
    if (res.ok) {
      const rows = await res.json();
      assert.deepEqual(rows, [], "anon must never receive rows from an unpoliced table");
    } else {
      assert.ok(res.status >= 400, "non-ok responses must be denials");
    }
  },
);
