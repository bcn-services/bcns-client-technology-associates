import { test, before } from "node:test";
import assert from "node:assert/strict";
import { resetDb, sql, one, errorOf, insertSql, syncSequences } from "./harness.mjs";
import { rows, CASE_ID } from "./fixtures/rows.ts";

const LEGACY = ["tblstates","tblbranches","tblcasestatus","tblcasepriority","tblcasewaitingfor","tblbillingnames","tblexptype","tblfirm","tblattorney","tblclient","tblinquiry","tblcase","tblbills","tblactivity","tblexpenses","tblfundsrcvd","tblsrvauth","tblcaseresult","tbl_scannedbillandcheck","tblscanneddocument"];

before(() => resetDb());

test("20 legacy tables exist, each with a primary key on its first column", () => {
  const tables = sql("select table_name from information_schema.tables where table_schema='public' order by 1").map((r) => r[0]);
  for (const t of LEGACY) assert.ok(tables.includes(t), `missing ${t}`);
  for (const t of LEGACY) {
    const first = one(`select column_name from information_schema.columns where table_name='${t}' and ordinal_position=1`);
    const pk = one(`select a.attname from pg_index i join pg_attribute a on a.attrelid=i.indrelid and a.attnum=any(i.indkey) where i.indrelid='${t}'::regclass and i.indisprimary`);
    assert.equal(pk, first, `${t} pk`);
  }
});

test("pinned column types and nullability hold on the columns lanes lean on", () => {
  const col = (t, c) => one(`select data_type||':'||is_nullable from information_schema.columns where table_name='${t}' and column_name='${c}'`);
  assert.equal(col("tblexpenses", "expamount"), "numeric:NO");
  assert.equal(col("tblexpenses", "expdate"), "date:NO");
  assert.equal(col("tblexpenses", "expclearedbank"), "boolean:YES");
  assert.equal(col("tblbills", "billpaiddate"), "date:YES");
  assert.equal(col("tblbills", "billbalance"), "numeric:NO");
  assert.equal(col("tblactivity", "acthrs"), "numeric:NO");
  assert.equal(col("tblcase", "casestatlastupdated"), "timestamp with time zone:YES");
  assert.equal(col("tblinquiry", "inqtime"), "time without time zone:YES");
  assert.equal(one("select count(*) from information_schema.columns where table_schema='public' and column_name='ssma_timestamp'"), "0");
});

// 0006: shapes the real .bak load rejected.
test("0006 amendments hold: nullable bits, wide hours, no phantom column", () => {
  const nullable = (t, c) => one(`select is_nullable from information_schema.columns where table_name='${t}' and column_name='${c}'`);
  const numtype = (t, c) => one(`select numeric_precision||','||numeric_scale from information_schema.columns where table_name='${t}' and column_name='${c}'`);
  for (const [t, c] of [["tblattorney","attyesq"],["tblbills","billestimate"],["tblcase","casestatharddeadline"],["tblexpenses","expclearedbank"],["tblexptype","active"],["tblfundsrcvd","fndsclearedbank"],["tblinquiry","sentchecklist"],["tblinquiry","sentcoppolino"],["tblinquiry","sentfee"],["tblinquiry","sentiuo"],["tblinquiry","sentiuobio"],["tblinquiry","sentkjs"],["tblinquiry","sentlarry"],["tblinquiry","sentllb"],["tblinquiry","sentoren"],["tblinquiry","sentother1"],["tblinquiry","sentother2"]]) {
    assert.equal(nullable(t, c), "YES", `${t}.${c} should be nullable`);
  }
  // Not in the 17: these are not null in SQL Server too.
  assert.equal(nullable("tblcase", "billingalert"), "NO");
  assert.equal(nullable("tblactivity", "actbilled"), "NO");
  for (const [t, c] of [["tblsrvauth","srvauthhours"],["tblbills","billhours"],["tblactivity","acthrs"]]) {
    assert.equal(numtype(t, c), "9,3", `${t}.${c} should be numeric(9,3)`);
  }
  assert.equal(one("select count(*) from information_schema.columns where table_name='tblcase' and column_name='casestatusharddeadline'"), "0");
  // Defaults survive the drop of not null.
  assert.equal(one("select column_default from information_schema.columns where table_name='tblcase' and column_name='casestatharddeadline'"), "false");
});

test("one fixture row per table inserts in FK-safe order", () => {
  sql(rows.map(([t, r]) => insertSql(t, r)).join("\n"));
  syncSequences();
  for (const t of LEGACY) assert.ok(Number(one(`select count(*) from ${t}`)) >= 1, `${t} empty`);
});

test("26 FKs exist, all NOT VALID, and reject a new orphan", () => {
  assert.equal(one("select count(*) from pg_constraint where contype='f' and connamespace='public'::regnamespace and conrelid::regclass::text like 'tbl%' and conname not in ('tblbills_supersedesbillid_fkey','tblactivity_actbillid_fkey','tblfundsrcvd_fndsbillid_fkey','tblbilllines_billid_fkey','tblbilllines_personid_fkey')"), "26");
  assert.equal(one("select count(*) from pg_constraint where contype='f' and convalidated and conrelid::regclass::text like 'tbl%' and conname not in ('tblbills_supersedesbillid_fkey','tblactivity_actbillid_fkey','tblfundsrcvd_fndsbillid_fkey','tblbilllines_billid_fkey','tblbilllines_personid_fkey')"), "0");
  const err = errorOf(insertSql("tblexpenses", { expcaseid: 1, expdate: "2026-01-01", expdscr: "orphan", expchecknum: 0, expamount: 1 }));
  assert.match(err ?? "", /foreign key/);
});

// 0009: bill output — priced lines a bill was sent with, plus finalize/send stamps.
test("0009 bill output: tblbilllines shape, new nullable tblbills columns, constraints", () => {
  const col = (t, c) => one(`select data_type||':'||is_nullable||':'||coalesce(numeric_precision||','||numeric_scale,'') from information_schema.columns where table_name='${t}' and column_name='${c}'`);
  const expected = {
    lineid: "integer:NO:32,0", billid: "integer:NO:32,0", lineno: "integer:NO:32,0", kind: "text:NO:",
    linedate: "date:YES:", description: "text:NO:", personid: "integer:YES:32,0",
    hours: "numeric:YES:9,3", rate: "numeric:YES:10,2", amount: "numeric:NO:12,2",
  };
  for (const [c, v] of Object.entries(expected)) assert.equal(col("tblbilllines", c), v, `tblbilllines.${c}`);
  assert.equal(one("select count(*) from information_schema.columns where table_name='tblbilllines'"), "10");
  assert.equal(one("select identity_generation from information_schema.columns where table_name='tblbilllines' and column_name='lineid'"), "ALWAYS");
  for (const [c, v] of [["billfinalizedat","timestamp with time zone:YES:"],["billpdfpath","text:YES:"],["billsentat","timestamp with time zone:YES:"],["billsentto","text:YES:"]]) {
    assert.equal(col("tblbills", c), v, `tblbills.${c}`);
    assert.equal(one(`select column_default is null from information_schema.columns where table_name='tblbills' and column_name='${c}'`), "t");
  }
  // FKs are app-added and validated (new table, no legacy orphans); billid restricts delete.
  assert.equal(one("select confdeltype||':'||convalidated from pg_constraint where conname='tblbilllines_billid_fkey'"), "r:true");
  assert.equal(one("select confrelid::regclass::text from pg_constraint where conname='tblbilllines_personid_fkey'"), "tblbillingnames");
  assert.equal(one("select count(*) from tblbilllines where billid=2"), "1");
  assert.equal(one("select count(*) from tblbilllines where billid=1"), "0", "legacy bill 1 has no lines");
  assert.match(errorOf(insertSql("tblbilllines", { billid: 2, lineno: 1, kind: "charge", description: "dup", amount: 1 })) ?? "", /unique/);
  assert.match(errorOf(insertSql("tblbilllines", { billid: 2, lineno: 9, kind: "discount", description: "bad kind", amount: 1 })) ?? "", /check constraint/);
  assert.match(errorOf(insertSql("tblbilllines", { billid: 999999, lineno: 1, kind: "charge", description: "orphan", amount: 1 })) ?? "", /foreign key/);
  // Every other FK into tblbills dropped inside a rolled-back txn, so only the new one can block the delete.
  assert.match(errorOf(`begin;
    do $$ declare r record; begin
      for r in select conrelid::regclass t, conname from pg_constraint where confrelid='tblbills'::regclass and conname<>'tblbilllines_billid_fkey' loop
        execute format('alter table %s drop constraint %I', r.t, r.conname);
      end loop; end $$;
    delete from tblbills where billid=2;
    rollback;`) ?? "", /tblbilllines_billid_fkey/);
});

test("explicit caseid keeps identity in step (setval documented for lane migration)", () => {
  assert.equal(one(`select caseid from tblcase where caseid=${CASE_ID}`), String(CASE_ID));
  sql(insertSql("tblcase", { caseatty: 1, casetitle: "Next", caseclient: 1, tabranch: "Hartford", status: "Active", casestartdate: "2026-03-01" }));
  assert.equal(one("select max(caseid) from tblcase"), String(CASE_ID + 1));
});
