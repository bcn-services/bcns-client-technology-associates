// Item 2 (unit): lib/case-docs/docs.ts — the kind list, the FormatAttyName / FormatAddress ports, the firm-time-zone
// date, and each kind's bookmark map from a fake Db. The date checks also run in child processes under TZ=UTC and
// TZ=America/Los_Angeles, so a server-local date goes red whichever TZ this file runs under. Invented data only.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const { CASE_DOCS, caseDoc, formatAttyName, formatAddress, todayText, loadCaseDocValues } = await import("../../lib/case-docs/docs.ts");
const { fillTemplate, UnknownBookmarkError } = await import("../../lib/case-docs/fill.ts");
const { TEMPLATE_DOTX } = await import("../../lib/case-docs/templates.ts");

const DOCS_TS = fileURLToPath(new URL("../../lib/case-docs/docs.ts", import.meta.url));
const TSX = fileURLToPath(new URL("../../node_modules/.bin/tsx", import.meta.url));
const OCT1_0330Z = new Date(Date.UTC(2026, 9, 1, 3, 30)); // 23:30 Sep 30 in New York
const NOW = new Date(Date.UTC(2026, 8, 5, 16, 0)); // Sep 5, noon New York

/** Fake Db: tblcase / tblattorney / tblfirm rows by id; select(...).eq(col, v).maybeSingle(). */
function fakeDb(rows) {
  const key = { tblcase: "caseid", tblattorney: "attyid", tblfirm: "frmid" };
  return {
    from: (table) => ({
      select: () => ({
        eq: (col, v) => {
          assert.equal(col, key[table], `${table} is looked up by its id`);
          return { maybeSingle: async () => ({ data: (rows[table] ?? []).find((r) => r[col] === v) ?? null, error: null }) };
        },
      }),
    }),
  };
}
const FIRM = { frmid: 7, frmname: "Example Firm LLP", frmaddress1: "1 Test St", frmaddress2: "Suite 2", frmcity: "Sampletown", frmstate: "NY", frmzip: "100019999" };
const ATTY = { attyid: 5, attyfirmid: 7, attytitle: "Mr.", attyfirstname: "Pat", attymiddlename: "Quinn", attylastname: "Example", attysuffix: "Jr.", attyesq: true };
const CASE = { caseid: 99001, casetitle: `Example & Co <v.> "Sample"`, casecaption: "Index No. 000/0000", caseatty: 5 };
const full = fakeDb({ tblcase: [CASE], tblattorney: [ATTY], tblfirm: [FIRM] });

test("kind list: four kinds, slug/label/template/file name, one lookup", () => {
  assert.deepEqual(CASE_DOCS.map((d) => [d.slug, d.label, d.template, d.fileName(99001)]), [
    ["memo", "Memo", "CTA_Memo", "Memo 99001.docx"],
    ["cta-report", "CTA Report", "CTA_REPORT", "CTA Report 99001.docx"],
    ["file-review-summary", "File Review Summary", "File_Review_Summary", "File Review Summary 99001.docx"],
    ["inspection-plan", "Inspection Plan", "Inspection_Plan", "Inspection Plan 99001.docx"],
  ]);
  assert.equal(caseDoc("memo"), CASE_DOCS[0]);
  assert.equal(caseDoc("nope"), undefined);
});

test("docs.ts stays light: no jszip, fill engine or template bytes (the case page imports it)", () => {
  const imports = readFileSync(DOCS_TS, "utf8").match(/^import .*$/gm);
  assert.ok(imports.length > 0);
  for (const line of imports) {
    assert.doesNotMatch(line, /jszip|pdf-lib|["']\.\/fill["']|bill-docs\//, line);
    if (/["']\.\/templates["']/.test(line)) assert.match(line, /^import type /, line);
  }
});

test("FormatAttyName port: first/middle-initial/last, suffix, Esq. vs title prefix", () => {
  const t = (...a) => formatAttyName(...a);
  assert.equal(t("Pat", "Quinn", "Example", true, "Mr.", "Jr."), "Pat Q. Example, Jr., Esq.");
  assert.equal(t("Pat", "Quinn", "Example", false, "Dr.", ""), "Dr. Pat Q. Example");
  assert.equal(t("Pat", "", "Example", false, "", ""), " Pat Example"); // blank title still prefixes "<title> "
  assert.equal(t("", "Quinn", "Example", false, "Ms.", ""), "Ms. Q. Example");
  assert.equal(t("", "", "Example", true, "Ms.", "III"), "Example, III, Esq."); // Esq. drops the title
  assert.equal(t("Pat", "", "", false, "Mr.", "Jr."), "Mr. Pat, Jr.");
  assert.equal(t("", "", "", false, "Mr.", "Jr."), "Mr. "); // suffix needs a name
  assert.equal(t("", "", "", true, "", ""), ", Esq.");
});

test("FormatAddress port: lines joined by \\n, City, ST zip, zip dash rules", () => {
  const t = (...a) => formatAddress(...a);
  assert.equal(t("1 Test St", "Suite 2", "Sampletown", "NY", "100019999"), "1 Test St\nSuite 2\nSampletown, NY 10001-9999");
  assert.equal(t("1 Test St", "", "Sampletown", "NY", "10001-"), "1 Test St\nSampletown, NY 10001");
  assert.equal(t("1 Test St", "", "Sampletown", "NY", "10001-9999"), "1 Test St\nSampletown, NY 10001-9999");
  assert.equal(t("1 Test St", "", "Sampletown", "NY", "10001"), "1 Test St\nSampletown, NY 10001");
  assert.equal(t("", "Suite 2", "", "", ""), "\nSuite 2");
  assert.equal(t("1 Test St", "", "", "NY", ""), "1 Test St\nNY ");
  assert.equal(t("", "", "Sampletown", "", ""), "Sampletown, ");
  assert.equal(t("", "", "", "", ""), "");
});

test("TodayDate: mmmm dd, yyyy in New York from the passed now", () => {
  assert.equal(todayText(NOW), "September 05, 2026");
  assert.equal(todayText(OCT1_0330Z), "September 30, 2026");
  assert.equal(todayText(new Date(Date.UTC(2027, 0, 1, 3, 30))), "December 31, 2026");
});

for (const TZ of ["UTC", "America/Los_Angeles"]) {
  test(`TodayDate under TZ=${TZ}: 03:30 UTC on the 1st is the prior month's last day`, () => {
    const code = `
      const m = await import(${JSON.stringify(DOCS_TS)});
      const { todayText, loadCaseDocValues } = m.todayText ? m : m.default;
      const db = { from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { caseid: 1, casetitle: "T", casecaption: "C", caseatty: null }, error: null }) }) }) }) };
      const now = new Date(${OCT1_0330Z.getTime()});
      console.log(JSON.stringify({ tz: new Date(${OCT1_0330Z.getTime()}).getDate(), text: todayText(now),
        memo: (await loadCaseDocValues(db, 1, "memo", now)).TodayDate,
        frs: (await loadCaseDocValues(db, 1, "file-review-summary", now)).TodayDate }));`;
    const r = spawnSync(TSX, ["--input-type=module", "-e", code], { env: { ...process.env, TZ }, encoding: "utf8" });
    assert.equal(r.status, 0, r.stderr);
    const out = JSON.parse(r.stdout.trim().split("\n").pop());
    assert.equal(out.tz, TZ === "UTC" ? 1 : 30, "child really runs in that TZ");
    assert.deepEqual([out.text, out.memo, out.frs], ["September 30, 2026", "September 30, 2026", "September 30, 2026"]);
  });
}

test("each kind's map has exactly its bookmark names, built from the case's rows", async () => {
  const m = (slug) => loadCaseDocValues(full, 99001, slug, NOW);
  assert.deepEqual(await m("memo"), {
    Atty: "Pat Q. Example, Jr., Esq.",
    Firm: "Example Firm LLP",
    Address: "1 Test St\nSuite 2\nSampletown, NY 10001-9999",
    TodayDate: "September 05, 2026",
    TitleCaption: `Index No. 000/0000, Example & Co <v.> "Sample"`,
  });
  assert.deepEqual(await m("cta-report"), {
    Atty: "Pat Quinn Example, Jr., Esq.\nExample Firm LLP\n1 Test St\nSuite 2\nSampletown, NY 100019999",
    Title: `Example & Co <v.> "Sample"`,
    CaseID: "99001",
  });
  assert.deepEqual(await m("file-review-summary"), { CaseTitle: `Example & Co <v.> "Sample"`, CaseID: "99001", TodayDate: "September 05, 2026" });
  assert.deepEqual(await m("inspection-plan"), {});
});

test("a non-Esq. attorney: title prefix, null parts as blanks", async () => {
  const db = fakeDb({ tblcase: [CASE], tblattorney: [{ ...ATTY, attyesq: null, attymiddlename: null, attysuffix: null, attytitle: "Ms." }], tblfirm: [FIRM] });
  assert.equal((await loadCaseDocValues(db, 99001, "memo", NOW)).Atty, "Ms. Pat Example");
});

test("no attorney → empty Atty/Firm/Address, TitleCaption filled; attorney without firm → Atty only; null caption", async () => {
  const noAtty = fakeDb({ tblcase: [{ ...CASE, caseatty: 404 }], tblattorney: [ATTY], tblfirm: [FIRM] });
  const memo = await loadCaseDocValues(noAtty, 99001, "memo", NOW);
  assert.deepEqual([memo.Atty, memo.Firm, memo.Address], ["", "", ""]);
  assert.equal(memo.TitleCaption, `Index No. 000/0000, Example & Co <v.> "Sample"`);
  assert.equal((await loadCaseDocValues(noAtty, 99001, "cta-report", NOW)).Atty, "");

  const noFirm = fakeDb({ tblcase: [CASE], tblattorney: [{ ...ATTY, attyfirmid: 404 }], tblfirm: [FIRM] });
  const m2 = await loadCaseDocValues(noFirm, 99001, "memo", NOW);
  assert.deepEqual([m2.Atty, m2.Firm, m2.Address], ["Pat Q. Example, Jr., Esq.", "", ""]);
  assert.equal((await loadCaseDocValues(noFirm, 99001, "cta-report", NOW)).Atty, "Pat Quinn Example, Jr., Esq.");

  const noCaption = fakeDb({ tblcase: [{ ...CASE, casecaption: null }] });
  assert.equal((await loadCaseDocValues(noCaption, 99001, "memo", NOW)).TitleCaption, `, Example & Co <v.> "Sample"`);
});

test("unknown case id → null for every kind", async () => {
  for (const d of CASE_DOCS) assert.equal(await loadCaseDocValues(full, 12345, d.slug, NOW), null);
});

test("every bookmark name a kind returns exists in that kind's template", async () => {
  for (const d of CASE_DOCS) {
    const values = await loadCaseDocValues(full, 99001, d.slug, NOW);
    const tpl = new Uint8Array(Buffer.from(TEMPLATE_DOTX[d.template], "base64"));
    await fillTemplate(tpl, values, NOW, "2026-09-05"); // throws UnknownBookmarkError on a name the template lacks
    await assert.rejects(fillTemplate(tpl, { ...values, NotABookmark: "x" }, NOW, "2026-09-05"), UnknownBookmarkError, "the check bites");
  }
});
