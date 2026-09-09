-- 0006: shapes the real .bak load rejected (amends 0001; 0001 is not edited).
-- 1. 17 bit columns are nullable in SQL Server. Legacy nulls are real data and load
--    as-is, so the not-null goes and the default stays.
alter table tblattorney alter column attyesq            drop not null;
alter table tblbills    alter column billestimate       drop not null;
alter table tblcase     alter column casestatharddeadline drop not null;
alter table tblexpenses alter column expclearedbank     drop not null;
alter table tblexptype  alter column active             drop not null;
alter table tblfundsrcvd alter column fndsclearedbank   drop not null;
alter table tblinquiry  alter column sentchecklist      drop not null;
alter table tblinquiry  alter column sentcoppolino      drop not null;
alter table tblinquiry  alter column sentfee            drop not null;
alter table tblinquiry  alter column sentiuo            drop not null;
alter table tblinquiry  alter column sentiuobio         drop not null;
alter table tblinquiry  alter column sentkjs            drop not null;
alter table tblinquiry  alter column sentlarry          drop not null;
alter table tblinquiry  alter column sentllb            drop not null;
alter table tblinquiry  alter column sentoren           drop not null;
alter table tblinquiry  alter column sentother1         drop not null;
alter table tblinquiry  alter column sentother2         drop not null;

-- 2. Source type is SQL Server `real`; numeric(8,2) rounded and mismatched on sum.
alter table tblsrvauth  alter column srvauthhours type numeric(9,3);
alter table tblbills    alter column billhours    type numeric(9,3);
alter table tblactivity alter column acthrs       type numeric(9,3);

-- 3. Phantom: duplicates casestatharddeadline, exists in no source table.
alter table tblcase drop column casestatusharddeadline;
