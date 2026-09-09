-- 0004: bank_transactions staging table (FOUNDATION.md item 4). Additive only.
-- Staging only, never a source of truth for the ledger.
create table bank_transactions (
  id bigint generated always as identity primary key,
  bankaccount text not null,
  postedon date not null,
  amount numeric(12,2) not null,
  description text not null,
  expid integer references tblexpenses(expid),
  fndsid integer references tblfundsrcvd(fndsid),
  importedat timestamptz not null default now(),
  unique (bankaccount, postedon, amount, description)
);

alter table bank_transactions enable row level security;
create policy authenticated_all on bank_transactions
  for all to authenticated using (true) with check (true);
