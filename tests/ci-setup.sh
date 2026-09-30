#!/usr/bin/env bash
# CI test environment: makes the runner's shadow stack look like a developer's
# machine before `pnpm test`. Sourced by .github/workflows/{ci,deploy}.yml after
# `supabase start && supabase db reset`. Never touches a hosted project.
#   - Supabase env from `supabase status` (plus DATABASE_URL for the sequence sync)
#   - FOUNDATION_PG_URL on the plain Postgres service container (port 5432) — the
#     foundation harness drops/creates its own database there, as on a Mac
#   - .env.test.local + tests/docs-reports/local-stack-setup.sh: grants, the private
#     case-documents bucket, fixture rows, e2e logins
eval "$(supabase status -o env \
  --override-name api.url=NEXT_PUBLIC_SUPABASE_URL \
  --override-name auth.anon_key=NEXT_PUBLIC_SUPABASE_ANON_KEY \
  --override-name auth.service_role_key=SUPABASE_SERVICE_ROLE_KEY \
  --override-name db.url=DATABASE_URL)"
export NEXT_PUBLIC_SUPABASE_URL NEXT_PUBLIC_SUPABASE_ANON_KEY SUPABASE_SERVICE_ROLE_KEY DATABASE_URL
export FOUNDATION_PG_URL="postgresql://postgres:postgres@localhost:5432/ta_ci_foundation"
export DOCS_REPORTS_LOCAL_STACK=1
cat > .env.test.local <<ENV
NEXT_PUBLIC_SUPABASE_URL=$NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_ANON_KEY=$NEXT_PUBLIC_SUPABASE_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY=$SUPABASE_SERVICE_ROLE_KEY
DATABASE_URL=$DATABASE_URL
ENV
bash tests/docs-reports/local-stack-setup.sh
