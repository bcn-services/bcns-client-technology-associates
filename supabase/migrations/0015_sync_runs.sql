-- 0014: sync_runs — one row per "Sync from Access" request (ta-sync lane, 2026-10-21).
-- An admin queues a run from /sync; the sync-legacy GitHub Action restores TA's newest nightly
-- backup and reloads the 20 legacy tables (scripts/migrate/sync.sh), updating this row as it goes.
-- Additive only: new table, nothing existing is touched. (0013 belongs to ta-tickets.)
create table sync_runs (
  id bigint generated always as identity primary key,
  status text not null default 'queued' check (status in ('queued', 'running', 'succeeded', 'failed')),
  requested_by uuid references profiles(id) on delete set null,
  requested_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz,
  backup_key text,
  backup_at timestamptz,
  run_url text,
  error text
);

-- The concurrency guard: at most one queued/running row can exist, whatever the app does.
create unique index sync_runs_one_active on sync_runs ((true)) where status in ('queued', 'running');

-- Admin-only read (same shape as 0012). No write policies: the app writes with the service role,
-- the workflow writes as the database owner.
alter table sync_runs enable row level security;
create policy sync_runs_select_admin on sync_runs
  for select to authenticated
  using (exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'admin'));

create trigger audit after insert or update or delete on sync_runs
  for each row execute function audit_row();
