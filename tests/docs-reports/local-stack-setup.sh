#!/usr/bin/env bash
# tests/docs-reports/local-stack-setup.sh — prepare the LOCAL Supabase stack for tests.
#
# Run once after `supabase start`. Never run this against a hosted project: it
# hard-refuses anything that is not the local container.
#
# Why this exists: `supabase start` applies supabase/migrations/* as `postgres`,
# but the resulting default privileges give anon/authenticated/service_role only
# REFERENCES,TRIGGER,TRUNCATE — no SELECT/INSERT/UPDATE/DELETE. A hosted Supabase
# project grants DML to those roles; the local stack does not. anon is deliberately
# not re-granted: the app only ever queries as authenticated or service_role. Without this the
# e2e seed fails with "permission denied for table profiles". The migrations are
# frozen and protected, so the grants live here as test setup instead.
set -euo pipefail

DB_CONTAINER="supabase_db_bcns-client-technology-associates"

if ! docker ps --format '{{.Names}}' | grep -qx "$DB_CONTAINER"; then
  echo "local Supabase stack is not running — start it with: supabase start" >&2
  exit 1
fi

psql() { docker exec -i "$DB_CONTAINER" psql -U postgres -d postgres -v ON_ERROR_STOP=1 "$@"; }

echo "granting DML on schema public to authenticated, service_role (local only)"
psql -q <<'SQL'
grant usage on schema public to authenticated, service_role;
grant all on all tables    in schema public to authenticated, service_role;
grant all on all sequences in schema public to authenticated, service_role;
grant all on all functions in schema public to authenticated, service_role;
alter default privileges in schema public grant all on tables    to authenticated, service_role;
alter default privileges in schema public grant all on sequences to authenticated, service_role;
-- GRANT ... ON ALL TABLES includes views; case_search (0007) is a plain view that bypasses RLS.
revoke all on public.case_search from anon;
SQL

echo "done. RLS policies from 0003_profiles_rls.sql still apply to authenticated;"
echo "service_role bypasses RLS, exactly as on the hosted project."

echo "creating the private case-documents bucket (never public)"
psql -q <<'SQL'
insert into storage.buckets (id, name, public) values ('case-documents', 'case-documents', false)
  on conflict (id) do update set public = false;
SQL

# Seed order matters: profiles.personid references tblbillingnames(personid), so the
# legacy fixture rows must exist before the auth users are created.
echo "seeding foundation fixtures, then e2e users"
set -a; . ./.env.test.local; set +a
pnpm exec tsx tests/cases/seed-fixtures.ts
pnpm exec tsx tests/app-shell/seed-e2e.ts

echo
echo "local stack ready. API http://127.0.0.1:54421 · Studio http://127.0.0.1:54423"
