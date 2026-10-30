-- HQ ticket sync, reply half: post a staff reply on a ticket without closing it (hq_ticket_resolve, 0016, closes).
-- Additive: one function, callable only by the hq_tickets role.

-- Add the 'bcns' message and move an Open ticket to In review; an In review ticket stays In review.
-- Returns 1 when written; 0 (nothing written) for a blank body, a Closed ticket or no such ticket, so a retry or a bad id
-- raises no FK or blank-body error. The row lock serializes against a concurrent close, so a reply never lands on a
-- ticket that closed first.
-- Author 'bcns' (not 'email') so ticket_reply_review (0014) does not also fire; the status flip is done here.
create function public.hq_ticket_reply(p_id int, p_body text)
returns int
language plpgsql security definer set search_path = '' as $$
declare s text;
begin
  -- coalesce: a null body is blank too (btrim(null) = '' is null, not true).
  if coalesce(btrim(p_body), '') = '' then return 0; end if;
  select status into s from public.tickets where id = p_id for update;
  if s is null or s = 'Closed' then return 0; end if;
  insert into public.ticket_messages (ticketid, author, body) values (p_id, 'bcns', p_body);
  update public.tickets set status = 'In review' where id = p_id and status = 'Open';
  return 1;
end $$;

revoke all on function public.hq_ticket_reply(int, text) from public, anon, authenticated;
grant execute on function public.hq_ticket_reply(int, text) to hq_tickets;
