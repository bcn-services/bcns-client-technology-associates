-- Bill output (billing-output lane, 2026-09-28): the priced lines a finalized bill
-- was sent with, plus when/where the bill was finalized, stored and emailed.
-- Additive only: new table, new nullable tblbills columns. Legacy bills keep them null.
create table tblbilllines (
  lineid integer generated always as identity primary key,
  billid integer not null,
  lineno integer not null,
  kind text not null check (kind in ('charge', 'estimate', 'credit', 'expense')),
  linedate date,
  description text not null,
  personid integer,
  hours numeric(9,3),
  rate numeric(10,2),
  amount numeric(12,2) not null,
  unique (billid, lineno),
  constraint tblbilllines_billid_fkey foreign key (billid) references tblbills(billid) on delete restrict,
  constraint tblbilllines_personid_fkey foreign key (personid) references tblbillingnames(personid)
);
create index tblbilllines_personid_idx on tblbilllines (personid);

alter table tblbills
  add column billfinalizedat timestamptz,
  add column billpdfpath text,
  add column billsentat timestamptz,
  add column billsentto text;

-- Same RLS + audit as every other table (0003, 0004, 0005).
alter table tblbilllines enable row level security;
create policy authenticated_all on tblbilllines
  for all to authenticated using (true) with check (true);
create trigger audit after insert or update or delete on tblbilllines
  for each row execute function audit_row();
