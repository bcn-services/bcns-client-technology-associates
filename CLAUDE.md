# CLAUDE.md — bcns client app

## What this repo is

A **bcns hosted-web client app**, generated from `bcns-app-template` via the
`/new-client-repo` skill. Next.js 14 (App Router, TS strict) on the shared
DigitalOcean droplet via PM2 · per-client Supabase project (Postgres/auth/
storage) · Cloudflare front · Resend for email · Anthropic API as an
**enhancement layer only** (app must work with it off). Platform authority:
`~/os/knowledge/library/bcns/hosting-reference.md` in the operator's `~/os`.

## Where things stand — check these before building

- **`CLIENT.md`** — the business brief and config decisions (storage backend,
  AI feature, webhook providers). If a decision there is marked "Undecided",
  stop and ask before building code that assumes an answer.
- **`TEMPLATE.md`** — the manifest of every customization point the template
  ships. When a `CLIENT.md` decision gets made, it lands at the file/seam
  `TEMPLATE.md` names for that decision (e.g. storage backend →
  `lib/storage.ts`).
- **`DEPLOY.md`** — deploy mechanics (droplet, PM2, Supabase, Cloudflare,
  UptimeRobot). Infra provisioning is manual, not part of repo scaffolding.
- **`STANDARDS.md`** — does not exist yet in a fresh stamp. Once real code
  patterns emerge (a repo seam, a locked architectural choice, a gotcha worth
  not re-learning), create it and record only what's particular to this
  codebase — the global dev-team standards cover the rest.

## Repo layout

Same shape as the template: `app/` (routes), `lib/` (one folder per domain,
thin bindings into `@nseluga/app-core` — shared logic lives there and reaches
every client via a version bump, not a per-repo edit), `supabase/migrations/`
(plain SQL via Supabase CLI, never hand-run), `tests/` (`pnpm test`;
`tests/rls-forbidden-read.test.mjs` is the standing RLS scaffold).

## Contract to preserve

The app must build and serve with **no environment variables set** and AI
**off** (`lib/env.ts` reads config lazily — never at import/build time). Don't
add code that reads `process.env` outside that seam or that assumes a
`CLIENT.md` config decision has already been made.
