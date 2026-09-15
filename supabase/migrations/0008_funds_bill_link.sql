-- Funds → bill link (money lane amendment, 2026-09-15): records which check paid which bill.
-- Additive and nullable; migrated legacy rows keep fndsbillid null (legacy never linked them).
alter table tblfundsrcvd add column fndsbillid integer;
alter table tblfundsrcvd add constraint tblfundsrcvd_fndsbillid_fkey
  foreign key (fndsbillid) references tblbills(billid);
create index tblfundsrcvd_fndsbillid_idx on tblfundsrcvd (fndsbillid);
