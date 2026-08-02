---
type: workflow-app
delivery: hosted-web
name: "@nseluga/hosted-web-template"
status: template
---

# hosted-web template

A runnable **Next.js 14 (App Router, TypeScript strict)** starter for the
standard hosted client app, matching the platform stack in
`hosting-reference.md` (**DigitalOcean droplet + Supabase per-client project +
Cloudflare**). It depends on the shared packages `@nseluga/ui`,
`@nseluga/config`, and `@nseluga/app-core` as **versioned dependencies from
GitHub Packages**, and ships the wiring points a real client build needs —
env-driven config, a `/api/health` DB probe, webhook hygiene seams, a storage
adapter interface, an RLS test scaffold, and an opt-in AI module — as safe,
keyless stubs.

> This is a **GitHub Template Repository**. Preferred: create a client repo
> with the **`/new-client-repo`** Claude Code skill, which applies every
> customization point listed in [`TEMPLATE.md`](TEMPLATE.md) and verifies the
> build. Manual fallback: **"Use this template"** (name it
> `bcns-client-<slug>`, keep it Private), then work through `TEMPLATE.md` by
> hand.

## Quick start

The `@nseluga/*` deps come from the private GitHub Packages registry (see `.npmrc`),
so set a token first:

```bash
export GITHUB_TOKEN=<PAT with read:packages>   # any machine that installs

pnpm install        # resolves @nseluga/* from GitHub Packages
pnpm dev            # serves on :3100
pnpm build
pnpm test
```

The app builds and serves an HTTP 200 home page with **no environment variables
set** and the AI feature flag **off**. Nothing reads `process.env` at import or
build time — config is read lazily inside request handlers (`lib/env.ts`), so
missing keys degrade gracefully instead of crashing.

## Environment variables

Copy `.env.example` → `.env.local` and fill in real values. `.env.example` is
committed with **placeholders only — no real secrets**. See `lib/env.ts` for
the single accessor; documented vars: `DATABASE_URL` (the client's Supabase
Postgres), Supabase (`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`,
and the server-only `SUPABASE_SERVICE_ROLE_KEY`, which bypasses RLS and must
never reach client-side code), and the per-app `ANTHROPIC_API_KEY` plus its
`AI_ENABLED` flag.

## What the template ships (the template contract)

The template is a **pure skeleton**: wiring, env, tests, and docs. The shared
logic behind these seams lives in `@nseluga/app-core` — the `lib/` files are
thin re-exports/bindings, so a platform fix reaches every client via a version
bump, not a per-repo edit. `TEMPLATE.md` is the manifest of everything that
changes when this becomes a client repo.

- **`lib/env.ts`** — lazy config accessor; the keyless-run guarantee. (The one
  lib file with real code here — env access is app wiring, not shared logic.)
- **`app/api/health`** (+ `lib/health.ts` → app-core) — real DB-connectivity
  probe for UptimeRobot: 200 when connected or unconfigured, 503 when a
  configured DB fails its ping. Pure evaluation, unit-tested in app-core.
- **`lib/webhooks.ts`** (→ app-core) — generic inbound-webhook hygiene: a
  fail-closed signature-verifier seam and an idempotent processing pipeline.
  **No provider-specific webhook routes ship in the template** — which
  processor / SMS / accounting webhooks a client needs is a per-client
  decision, and BCNS's own fee billing is handled centrally, never in-app.
- **`lib/storage.ts`** — this app's adapter seam over app-core's
  `StorageAdapter` interface. Platform default is Supabase Storage; a
  client-specific backend (e.g. self-hosted Nextcloud via WebDAV) implements
  the same interface so it never hardens into the template. Files are keyed to
  canonical business ids; private content via signed URLs.
- **`supabase/migrations/`** — plain SQL migrations, applied by the Supabase
  CLI from CI against the client's project. Never hand-run SQL in a dashboard.
- **`tests/rls-forbidden-read.test.mjs`** — the standing scaffold for
  RLS-policy tests: forbidden reads must fail, from commit one. Skips until
  Supabase env exists; client builds extend it per protected table/role.
- **`lib/ai.ts`** (→ app-core) — opt-in AI module (below).

## Opt-in AI module (`lib/ai.ts`)

AI is **genuinely opt-in**. `maybeGetAiClient` binds this app's env config to
app-core's `maybeCreateAnthropicClient`, which checks `AI_ENABLED` first and
returns `null` before the client factory is ever referenced. The client is constructed only when the flag is on **and** a key is
present. The client's Anthropic key is read from env, never from source. See
`tests/ai-optin.test.mjs` for the import-boundary proof of non-invocation.

## Relationship to the bcns platform repo

This standalone repo is the **canonical template** (originally extracted from
the [`bcns`](https://github.com/nseluga/bcns) platform repo; the old
`templates/hosted-web/` copy there has been deleted). The shared `@nseluga/*`
packages are developed and published from `bcns`; this template (and every
client repo generated from it) consumes them by version. To roll out a shared improvement:
publish a new package version from `bcns`, then bump the range here / in each
client repo. See `bcns/SETUP.md` for the full topology and conventions.

## Deploy

See `DEPLOY.md` — DigitalOcean droplet + PM2 (one process per client, memory
limit) + Cloudflare + a per-client Supabase project. Plain Node processes, no
containers; deploy = git pull → build → `pm2 reload`.
