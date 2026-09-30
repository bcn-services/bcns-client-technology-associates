// Item 2 (live): loadCaseDocValues against the LOCAL Supabase stack (.env.local). Own rows: firm/attorney 992801,
// case 992801 (with attorney and firm) and 992802 (caseatty pointing at no attorney — the NOT VALID FK lets migrated
// rows do this; set here with session_replication_role=replica via psql). Removed at setup and in after(). Invented data.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { loadEnvLocal } from "../app-shell/seed-e2e.ts";
import { createServerClient } from "../../lib/db/client.ts";
import { CASE_DOCS, loadCaseDocValues } from "../../lib/case-docs/docs.ts";

loadEnvLocal();
const LOCAL = /^https?:\/\/(127\.0\.0\.1|localhost)[:/]/.test(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "")
  && /@(127\.0\.0\.1|localhost):/.test(process.env.DATABASE_URL ?? "");
const up = LOCAL && await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/`).then(() => true, () => false);
const skip = up && process.env.SUPABASE_SERVICE_ROLE_KEY ? false : "local Supabase unavailable";
const CASE = 992801, ORPHAN = 992802, ATTY = 992801, FIRM = 992801, NOW = new Date(Date.UTC(2026, 9, 1, 3, 30));
const TITLE = `Example & Co <v.> "Sample"`;
let db;
const ok = ({ data, error }) => { if (error) throw new Error(error.message); return data; };
const cleanup = async () => {
  ok(await db.from("tblcase").delete().in("caseid", [CASE, ORPHAN]));
  ok(await db.from("tblattorney").delete().eq("attyid", ATTY));
  ok(await db.from("tblfirm").delete().eq("frmid", FIRM));
};

before(async () => {
  if (skip) return;
  db = createServerClient();
  await cleanup();
  ok(await db.from("tblfirm").insert({ frmid: FIRM, frmname: "Example Firm LLP", frmaddress1: "1 Test St", frmaddress2: "Suite 2", frmcity: "Sampletown", frmstate: "NY", frmzip: "100019999", frmactive: true }));
  ok(await db.from("tblattorney").insert({ attyid: ATTY, attyfirmid: FIRM, attytitle: "Mr.", attyfirstname: "Pat", attymiddlename: "Quinn", attylastname: "Example", attysuffix: "Jr.", attyesq: true, attyemail: "pat@example.test" }));
  const src = ok(await db.from("tblcase").select("*").eq("caseid", 90001).single());
  ok(await db.from("tblcase").insert([
    { ...src, caseid: CASE, caseatty: ATTY, casecaption: "Index No. 000/0000", casetitle: TITLE },
    { ...src, caseid: ORPHAN, caseatty: ATTY, casecaption: "Orphan Caption", casetitle: "Orphan v. Nobody" },
  ]));
  const r = spawnSync("psql", [process.env.DATABASE_URL, "-v", "ON_ERROR_STOP=1", "-c",
    `begin; set local session_replication_role = replica; update tblcase set caseatty = 992899 where caseid = ${ORPHAN}; commit;`], { encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
});
after(async () => { if (db) await cleanup(); });

test("live: each kind's map from the case's real rows", { skip }, async () => {
  const m = (slug) => loadCaseDocValues(db, CASE, slug, NOW);
  assert.deepEqual(await m("memo"), {
    Atty: "Pat Q. Example, Jr., Esq.", Firm: "Example Firm LLP", Address: "1 Test St\nSuite 2\nSampletown, NY 10001-9999",
    TodayDate: "September 30, 2026", TitleCaption: `Index No. 000/0000, ${TITLE}`,
  });
  assert.deepEqual(await m("cta-report"), { Atty: "Pat Quinn Example, Jr., Esq.\nExample Firm LLP\n1 Test St\nSuite 2\nSampletown, NY 100019999", Title: TITLE, CaseID: String(CASE) });
  assert.deepEqual(await m("file-review-summary"), { CaseTitle: TITLE, CaseID: String(CASE), TodayDate: "September 30, 2026" });
  assert.deepEqual(await m("inspection-plan"), { CaseTitle: TITLE, CaseID: String(CASE) });
});

test("live: case whose attorney row is missing → empty Atty/Firm/Address, TitleCaption filled; unknown case → null", { skip }, async () => {
  const memo = await loadCaseDocValues(db, ORPHAN, "memo", NOW);
  assert.deepEqual([memo.Atty, memo.Firm, memo.Address, memo.TitleCaption], ["", "", "", "Orphan Caption, Orphan v. Nobody"]);
  assert.equal((await loadCaseDocValues(db, ORPHAN, "cta-report", NOW)).Atty, "");
  for (const d of CASE_DOCS) assert.equal(await loadCaseDocValues(db, 992899, d.slug, NOW), null);
});
