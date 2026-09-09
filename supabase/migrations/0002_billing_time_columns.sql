-- 0002: billing/time extension columns (FOUNDATION.md item 2). Additive only.
alter table tblbills
  add column billtype text null check (billtype in ('blank','timesheet','depoprep','depo','trial','retainer')),
  add column supersedesbillid integer null references tblbills(billid);
alter table tblactivity
  add column actbillid integer null references tblbills(billid),
  add constraint tblactivity_billed_pair check (actbillid is null or actbilled);
-- unbilled work := actbilled = false and actbillid is null
