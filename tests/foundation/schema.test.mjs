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
  assert.equal(col("tblexpenses", "expclearedbank"), "boolean:NO");
  assert.equal(col("tblbills", "billpaiddate"), "date:YES");
  assert.equal(col("tblbills", "billbalance"), "numeric:NO");
  assert.equal(col("tblactivity", "acthrs"), "numeric:NO");
  assert.equal(col("tblcase", "casestatlastupdated"), "timestamp with time zone:YES");
  assert.equal(col("tblinquiry", "inqtime"), "time without time zone:YES");
  assert.equal(one("select count(*) from information_schema.columns where table_schema='public' and column_name='ssma_timestamp'"), "0");
});

test("one fixture row per table inserts in FK-safe order", () => {
  sql(rows.map(([t, r]) => insertSql(t, r)).join("\n"));
  syncSequences();
  for (const t of LEGACY) assert.ok(Number(one(`select count(*) from ${t}`)) >= 1, `${t} empty`);
});

test("26 FKs exist, all NOT VALID, and reject a new orphan", () => {
  assert.equal(one("select count(*) from pg_constraint where contype='f' and connamespace='public'::regnamespace and conrelid::regclass::text like 'tbl%' and conname not in ('tblbills_supersedesbillid_fkey','tblactivity_actbillid_fkey')"), "26");
  assert.equal(one("select count(*) from pg_constraint where contype='f' and convalidated and conrelid::regclass::text like 'tbl%' and conname not in ('tblbills_supersedesbillid_fkey','tblactivity_actbillid_fkey')"), "0");
  const err = errorOf(insertSql("tblexpenses", { expcaseid: 1, expdate: "2026-01-01", expdscr: "orphan", expchecknum: 0, expamount: 1 }));
  assert.match(err ?? "", /foreign key/);
});

test("explicit caseid keeps identity in step (setval documented for lane migration)", () => {
  assert.equal(one(`select caseid from tblcase where caseid=${CASE_ID}`), String(CASE_ID));
  sql(insertSql("tblcase", { caseatty: 1, casetitle: "Next", caseclient: 1, tabranch: "Hartford", status: "Active", casestartdate: "2026-03-01" }));
  assert.equal(one("select max(caseid) from tblcase"), String(CASE_ID + 1));
});
