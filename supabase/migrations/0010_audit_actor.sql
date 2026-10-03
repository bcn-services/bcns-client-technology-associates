-- 0010: audit_log.actor records who acted (contract D7). The app writes through the
-- service-role client, so auth.uid() is null there; middleware.ts verifies the user and
-- lib/db/client.ts forwards their id as the `x-app-actor` request header, which
-- PostgREST exposes in request.headers. auth.uid() wins, so a user JWT can't claim
-- another actor; anon has no write policy anywhere, so only the service role can set it.
-- This function runs on every write in the app: it must never raise. A missing,
-- malformed, or non-uuid header gives actor = null and the write goes through.
create or replace function audit_row() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  pkcol text;
  rid text;
  who uuid := auth.uid();
  hdr text;
begin
  if who is null then
    begin
      hdr := current_setting('request.headers', true)::json ->> 'x-app-actor';
    exception when others then
      hdr := null; -- unparseable request.headers: no actor, never a failed write
    end;
    if hdr ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      who := hdr::uuid;
    end if;
  end if;

  select a.attname into pkcol
  from pg_index i
  join pg_attribute a on a.attrelid = i.indrelid and a.attnum = any(i.indkey)
  where i.indrelid = tg_relid and i.indisprimary
  limit 1;

  if tg_op = 'DELETE' then
    rid := to_jsonb(old) ->> pkcol;
    insert into audit_log (tablename, rowid, op, olddata, newdata, actor)
      values (tg_table_name, rid, tg_op, to_jsonb(old), null, who);
    return old;
  elsif tg_op = 'UPDATE' then
    rid := to_jsonb(new) ->> pkcol;
    insert into audit_log (tablename, rowid, op, olddata, newdata, actor)
      values (tg_table_name, rid, tg_op, to_jsonb(old), to_jsonb(new), who);
    return new;
  else
    rid := to_jsonb(new) ->> pkcol;
    insert into audit_log (tablename, rowid, op, olddata, newdata, actor)
      values (tg_table_name, rid, tg_op, null, to_jsonb(new), who);
    return new;
  end if;
end;
$$;
