-- 0005: generic audit trail (FOUNDATION.md item 5). Runs last: trigger applies to every
-- table that exists by now, including profiles and bank_transactions.
create table audit_log (
  id bigint generated always as identity primary key,
  tablename text not null,
  rowid text not null,
  op text not null check (op in ('INSERT','UPDATE','DELETE')),
  olddata jsonb,
  newdata jsonb,
  actor uuid,
  at timestamptz not null default now()
);

alter table audit_log enable row level security;
create policy audit_log_select_authenticated on audit_log
  for select to authenticated using (true);
-- No insert/update/delete policy anywhere: nothing but the trigger (security definer,
-- runs as the migration owner) can write here.

create or replace function audit_row() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  pkcol text;
  rid text;
begin
  select a.attname into pkcol
  from pg_index i
  join pg_attribute a on a.attrelid = i.indrelid and a.attnum = any(i.indkey)
  where i.indrelid = tg_relid and i.indisprimary
  limit 1;

  if tg_op = 'DELETE' then
    rid := to_jsonb(old) ->> pkcol;
    insert into audit_log (tablename, rowid, op, olddata, newdata, actor)
      values (tg_table_name, rid, tg_op, to_jsonb(old), null, auth.uid());
    return old;
  elsif tg_op = 'UPDATE' then
    rid := to_jsonb(new) ->> pkcol;
    insert into audit_log (tablename, rowid, op, olddata, newdata, actor)
      values (tg_table_name, rid, tg_op, to_jsonb(old), to_jsonb(new), auth.uid());
    return new;
  else
    rid := to_jsonb(new) ->> pkcol;
    insert into audit_log (tablename, rowid, op, olddata, newdata, actor)
      values (tg_table_name, rid, tg_op, null, to_jsonb(new), auth.uid());
    return new;
  end if;
end;
$$;

do $$
declare t text;
begin
  for t in
    select table_name from information_schema.tables
    where table_schema = 'public' and table_type = 'BASE TABLE' and table_name <> 'audit_log'
  loop
    execute format('create trigger audit after insert or update or delete on %I for each row execute function audit_row()', t);
  end loop;
end $$;
