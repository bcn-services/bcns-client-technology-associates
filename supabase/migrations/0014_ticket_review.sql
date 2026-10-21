-- Ticket review loop: a third status, plus a message thread per ticket (staff responses and Nate's
-- emailed replies). Additive: one widened check, one new table.
alter table tickets drop constraint tickets_status_check;
alter table tickets add constraint tickets_status_check check (status in ('Open', 'In review', 'Closed'));

create table ticket_messages (
  id integer generated always as identity primary key,
  ticketid integer not null,
  author text not null, -- staff email, or 'email' for an inbound reply
  body text not null check (btrim(body) <> ''),
  resend_email_id text unique, -- inbound only: a webhook retry of the same email is a no-op
  createdat timestamptz not null default now(),
  constraint ticket_messages_ticketid_fkey foreign key (ticketid) references tickets(id) on delete restrict
);
create index ticket_messages_ticketid_idx on ticket_messages (ticketid);

-- Same RLS + audit as every other table (0003, 0005, 0009).
alter table ticket_messages enable row level security;
create policy authenticated_all on ticket_messages
  for all to authenticated using (true) with check (true);
create trigger audit after insert or update or delete on ticket_messages
  for each row execute function audit_row();
