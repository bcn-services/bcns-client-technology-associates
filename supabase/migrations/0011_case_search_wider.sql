-- 0011: widen case_search so quick search (one PostgREST or=) reaches every case text field (contract A1):
-- subject, status, priority, point man, waiting for, description, event description. All are plain text
-- on tblcase (status/priority/waiting-for hold the display text, not ids), so no extra joins.
-- create or replace view may only append columns: the 0007 columns stay first, in order. Grants carry over.

create or replace view case_search as
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
  c.otherexperts,
  c.casesubject,
  c.status,
  c.casestatpriority,
  c.casestatpointman,
  c.casestatwaitingfor,
  c.casestatdescription,
  c.casestatduedatedescription
from tblcase c
left join tblattorney a on a.attyid = c.caseatty
left join tblfirm f on f.frmid = a.attyfirmid
left join tblclient cl on cl.clientid = c.caseclient;
