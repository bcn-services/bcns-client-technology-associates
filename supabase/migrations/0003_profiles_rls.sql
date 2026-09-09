-- 0003: profiles + RLS (FOUNDATION.md item 3). Single tenant: authenticated reads/writes everything;
-- profiles is the one exception (admin-only writes).

create table profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  role text not null check (role in ('admin','staff')),
  personid smallint references tblbillingnames(personid),
  createdat timestamptz not null default now()
);

alter table profiles enable row level security;

create policy profiles_select_authenticated on profiles
  for select to authenticated using (true);

create policy profiles_insert_admin on profiles
  for insert to authenticated
  with check (exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'admin'));

create policy profiles_update_admin on profiles
  for update to authenticated
  using (exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'admin'))
  with check (exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'admin'));

create policy profiles_delete_admin on profiles
  for delete to authenticated
  using (exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'admin'));

-- Every other public table (the 20 legacy tables at this point in the migration order):
-- RLS on, single blanket policy, no per-row ownership.
do $$
declare t text;
begin
  for t in
    select table_name from information_schema.tables
    where table_schema = 'public' and table_type = 'BASE TABLE' and table_name <> 'profiles'
  loop
    execute format('alter table %I enable row level security', t);
    execute format('create policy authenticated_all on %I for all to authenticated using (true) with check (true)', t);
  end loop;
end $$;
