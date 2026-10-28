-- HQ ticket sync: a narrow login role for the HQ droplet's `tickets` job. It can call exactly two functions
-- (pull recent tickets, resolve one) and has no table grants, so RLS and the 24 policies are untouched.
-- Additive: one role, two functions.
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'hq_tickets') then
    create role hq_tickets login noinherit nobypassrls connection limit 3;
  end if;
end $$;
-- Roles are cluster-global: re-assert the timeout on every apply.
alter role hq_tickets set statement_timeout = '5s';
grant usage on schema public to hq_tickets;

-- Tickets touched in the last 90 days, shaped for HQ (slug, one-line subject, body, source-neutral status).
create function public.hq_tickets_pull()
returns table (id int, slug text, subject text, body text, severity text, status text, created_at timestamptz, updated_at timestamptz)
language sql security definer set search_path = '' as $$
  select t.id::int, 'technology-associates', left(t.description, 80), t.description, 'normal',
         case when t.status = 'Closed' then 'closed' else 'open' end,
         t.createdat, greatest(t.createdat, max(m.createdat))
  from public.tickets t
  left join public.ticket_messages m on m.ticketid = t.id
  group by t.id
  having greatest(t.createdat, max(m.createdat)) > now() - interval '90 days'
$$;

-- Push back a resolution: optional 'bcns' message, then Closed. Returns ticket rows changed (0 = already Closed).
-- Author 'bcns' (not 'email') so ticket_reply_review (0014) does not flip the ticket back to In review.
create function public.hq_ticket_resolve(p_id int, p_body text)
returns int
language plpgsql security definer set search_path = '' as $$
declare n int;
begin
  -- btrim, not just <> '': ticket_messages rejects blank bodies and a raised error would retry forever.
  if btrim(p_body) <> '' then
    insert into public.ticket_messages (ticketid, author, body) values (p_id, 'bcns', p_body);
  end if;
  update public.tickets set status = 'Closed' where id = p_id and status <> 'Closed';
  get diagnostics n = row_count;
  return n;
end $$;

revoke all on function public.hq_tickets_pull() from public, anon, authenticated;
revoke all on function public.hq_ticket_resolve(int, text) from public, anon, authenticated;
grant execute on function public.hq_tickets_pull() to hq_tickets;
grant execute on function public.hq_ticket_resolve(int, text) to hq_tickets;

-- By hand, once per project (never in a file): alter role hq_tickets password '<paste>';
