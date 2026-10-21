-- Tickets: change requests TA staff log for the app. Additive only: one new table.
create table tickets (
  id integer generated always as identity primary key,
  ticketdate date not null default current_date,
  description text not null check (btrim(description) <> ''),
  status text not null default 'Open' check (status in ('Open', 'Closed')),
  createdat timestamptz not null default now()
);

-- Same RLS + audit as every other table (0003, 0005, 0009).
alter table tickets enable row level security;
create policy authenticated_all on tickets
  for all to authenticated using (true) with check (true);
create trigger audit after insert or update or delete on tickets
  for each row execute function audit_row();
