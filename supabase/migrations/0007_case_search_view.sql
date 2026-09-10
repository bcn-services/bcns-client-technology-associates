-- 0007: case_search — the columns legacy viewCaseSearch exposed to CaseSearchQueryView
-- (SQL Server view, DDL not in the .bak restore; reconstructed from the Access query).
-- LEFT JOINs: FKs are NOT VALID, so an inner join would silently drop orphan legacy cases.
-- A view runs with its owner's rights (security_invoker needs PG15; local harness is PG14),
-- so access is granted explicitly: authenticated already reads every case table.

create view case_search as
select
  c.caseid,
  c.casetitle,
  c.casenotes,
  c.casecaption,
  concat_ws(' ', nullif(a.attyfirstname, ''), nullif(a.attymiddlename, ''), nullif(a.attylastname, '')) as attyname,
  a.attyemail,
  a.attyphone,
  f.frmname,
  f.frmphone,
  concat_ws(' ', nullif(cl.clientfirstname, ''), nullif(cl.clientlastname, '')) as clientname,
  c.otherexperts
from tblcase c
left join tblattorney a on a.attyid = c.caseatty
left join tblfirm f on f.frmid = a.attyfirmid
left join tblclient cl on cl.clientid = c.caseclient;

revoke all on case_search from public, anon;
grant select on case_search to authenticated, service_role;
