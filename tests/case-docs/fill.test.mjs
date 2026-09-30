// Item 1 fill engine (unit): fillTemplate (lib/case-docs/fill.ts) against the four real templates, read from the
// generated base64 module (lib/case-docs/templates.ts) — the only source the app has at runtime.
// Every filled value is invented; nothing here is a real attorney, firm, address or case.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, writeFileSync, mkdtempSync, existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import JSZip from "jszip";

const { fillTemplate, UnknownBookmarkError, UnsupportedTemplateError } = await import("../../lib/case-docs/fill.ts");
const { TEMPLATE_DOTX } = await import("../../lib/case-docs/templates.ts");

const TSX = fileURLToPath(new URL("../../node_modules/.bin/tsx", import.meta.url));
const DIR = new URL("../../lib/case-docs/templates/", import.meta.url);
const TEMPLATE_TYPE = "application/vnd.openxmlformats-officedocument.wordprocessingml.template.main+xml";
const DOCUMENT_TYPE = "application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml";
const CHANGED = ["[Content_Types].xml", "word/document.xml", "docProps/core.xml", "word/_rels/settings.xml.rels"];
/** The creation moment every fill here stamps: 11:00 Sep 30 2026 in New York. */
const NOW = new Date(Date.UTC(2026, 8, 30, 15, 0));
const fill = (tpl, values) => fillTemplate(tpl, values, NOW, "2026-09-30");

const TRICKY_TITLE = `Example & Sons <LLP> v. "Sample" Co's Widgets`;
const MEMO = {
  Atty: "Pat Example, Esq.",
  Firm: "Example & Sons <LLP>",
  Address: "1 Test St\nSuite 2",
  TodayDate: "January 02, 2031",
  TitleCaption: `Index No. 000/0000, ${TRICKY_TITLE}`,
};
/** Per template: values for the bookmarks the app fills, and a piece of the template's own text that must survive. */
const CASES = {
  CTA_Memo: { values: MEMO, boilerplate: "Memo to:" },
  CTA_REPORT: { values: { Title: TRICKY_TITLE, CaseID: "99001", Atty: "Pat Example, Esq.\nExample & Sons <LLP>\n1 Test St" }, boilerplate: "TA REPORT #" },
  File_Review_Summary: { values: { CaseID: "99001", CaseTitle: TRICKY_TITLE, TodayDate: "January 02, 2031" }, boilerplate: "Summary Outline" },
  Inspection_Plan: { values: {}, boilerplate: "Additional notes:" },
};

const bytes = (name) => new Uint8Array(Buffer.from(TEMPLATE_DOTX[name], "base64"));
const entries = async (buf) => {
  const zip = await JSZip.loadAsync(buf);
  const out = {};
  for (const [path, f] of Object.entries(zip.files)) if (!f.dir) out[path] = Buffer.from(await f.async("uint8array"));
  return out;
};
const unescape = (s) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");

/** Raw XML between a bookmark's start marker and the end marker carrying the same id. */
function between(xml, name) {
  const start = new RegExp(`<w:bookmarkStart\\b[^>]*w:name="${name}"[^>]*/>`).exec(xml);
  assert.ok(start, `bookmarkStart ${name} is still in the document`);
  const id = /w:id="(\d+)"/.exec(start[0])[1];
  const rest = xml.slice(start.index + start[0].length);
  const end = new RegExp(`<w:bookmarkEnd\\b[^>]*w:id="${id}"[^>]*/>`).exec(rest);
  assert.ok(end, `bookmarkEnd for ${name} is still in the document`);
  return rest.slice(0, end.index);
}
/** The text a reader sees in a stretch of runs: w:t contents, w:br as a newline. */
const textOf = (xml) => unescape([...xml.matchAll(/<w:t(?: [^>]*)?>([^<]*)<\/w:t>|<w:br\/>/g)].map((m) => (m[0] === "<w:br/>" ? "\n" : m[1])).join(""));

/** CREATEDATE fields in document order: picture and the raw XML of the cached result (separate run → end run). */
const dateFields = (xml) => [...xml.matchAll(/<w:instrText[^>]*> CREATEDATE {2}\\@ "([^"]*)" <\/w:instrText><\/w:r>(<w:r\b(?:(?!<\/w:r>).)*w:fldCharType="separate"\/><\/w:r>)((?:(?!w:fldChar).)*?)(?=<w:r\b(?:(?!<\/w:r>).)*w:fldCharType="end")/g)]
  .map((m) => ({ picture: m[1], result: m[3] }));
/** document.xml with the CREATEDATE cached results cut out — the only other place a fill with no values may touch. */
const withoutDateResults = (xml) => dateFields(xml).reduce((x, f) => x.replace(f.result, ""), xml);
const coreDates = (core) => ["created", "modified"].map((t) => new RegExp(`<dcterms:${t}\\b[^>]*>([^<]*)<`).exec(core)?.[1]);

/** Well-formedness: every tag balanced, attributes quoted, no bare `&` or `<` in text. xmllint too where it exists. */
function assertWellFormed(xml, label) {
  const stack = [];
  let last = 0;
  const checkText = (t) => assert.ok(!/&(?!(?:amp|lt|gt|quot|apos|#\d+|#x[0-9a-fA-F]+);)/.test(t), `${label}: bare & in ${JSON.stringify(t.slice(0, 80))}`);
  for (const m of xml.matchAll(/<(\?[\s\S]*?\?|\/?)([\w:.-]*)((?:\s+[\w:.-]+\s*=\s*(?:"[^"<]*"|'[^'<]*'))*)\s*(\/?)>/g)) {
    const gap = xml.slice(last, m.index);
    assert.ok(!gap.includes("<"), `${label}: malformed tag near ${JSON.stringify(gap.slice(0, 80))}`);
    checkText(gap);
    checkText(m[3]);
    last = m.index + m[0].length;
    if (m[1].startsWith("?")) continue;
    if (m[1] === "/") assert.equal(stack.pop(), m[2], `${label}: </${m[2]}> closes the wrong element`);
    else if (m[4] !== "/") stack.push(m[2]);
  }
  assert.equal(xml.slice(last).trim(), "", `${label}: trailing junk`);
  assert.deepEqual(stack, [], `${label}: unclosed elements`);
  if (existsSync("/usr/bin/xmllint")) {
    const r = spawnSync("/usr/bin/xmllint", ["--noout", "-"], { input: xml });
    assert.equal(r.status, 0, `${label}: xmllint: ${r.stderr}`);
  }
}

test("the well-formedness check itself rejects broken XML", () => {
  for (const bad of ["<a><b></a></b>", "<a>x & y</a>", "<a>1 < 2</a>", "<a>", '<a b="x<y"/>'])
    assert.throws(() => assertWellFormed(bad, "bad"), undefined, bad);
  assertWellFormed('<?xml version="1.0"?><a b="1"><c/>x &amp; y</a>', "good");
});

for (const [name, { values }] of Object.entries(CASES)) {
  test(`${name}: output is a .docx — unzips, document.xml parses, document content type, every other entry byte-identical`, async () => {
    const before = await entries(bytes(name));
    const after = await entries(await fill(bytes(name), values));
    assert.deepEqual(Object.keys(after), Object.keys(before), "same entries, same order");
    assertWellFormed(after["word/document.xml"].toString("utf8"), `${name} document.xml`);
    assertWellFormed(after["[Content_Types].xml"].toString("utf8"), `${name} [Content_Types].xml`);
    const types = after["[Content_Types].xml"].toString("utf8");
    assert.ok(types.includes(`<Override PartName="/word/document.xml" ContentType="${DOCUMENT_TYPE}"/>`), "main part is the document type");
    assert.ok(!types.includes(TEMPLATE_TYPE), "template type is gone");
    assert.equal(types, before["[Content_Types].xml"].toString("utf8").replace(TEMPLATE_TYPE, DOCUMENT_TYPE), "nothing else in [Content_Types].xml moved");
    let same = 0;
    for (const path of Object.keys(before)) {
      if (CHANGED.includes(path)) continue;
      assert.ok(before[path].equals(after[path]), `${path} is byte-identical`);
      same++;
    }
    assert.ok(same >= 10, "compared the rest of the package");
    // Outside the filled bookmarks the document is the template's: same markers, same count.
    const count = (x) => (x.match(/<w:bookmark(?:Start|End)\b/g) ?? []).length;
    assert.equal(count(after["word/document.xml"].toString("utf8")), count(before["word/document.xml"].toString("utf8")), "no bookmark marker lost");
  });

  test(`${name}: each value sits between its bookmark's markers and reads back as the same text`, async () => {
    const xml = (await entries(await fill(bytes(name), values)))["word/document.xml"].toString("utf8");
    for (const [bookmark, value] of Object.entries(values)) assert.equal(textOf(between(xml, bookmark)), value, bookmark);
  });

  test(`${name}: textutil reads the filled file and finds every value and the boilerplate`, { skip: existsSync("/usr/bin/textutil") ? false : "textutil is macOS-only — not present here" }, async () => {
    const file = join(mkdtempSync(join(tmpdir(), "case-docs-")), `${name}.docx`);
    writeFileSync(file, await fill(bytes(name), values));
    const r = spawnSync("/usr/bin/textutil", ["-convert", "txt", "-stdout", file], { encoding: "utf8" });
    assert.equal(r.status, 0, r.stderr);
    const flat = (s) => s.replace(/\s+/g, " ").toLowerCase(); // w:br comes back as a line separator; w:caps text may be upper-cased
    const text = flat(r.stdout);
    assert.ok(text.includes(flat(CASES[name].boilerplate)), `boilerplate "${CASES[name].boilerplate}"`);
    for (const [bookmark, value] of Object.entries(values)) assert.ok(text.includes(flat(value)), `${bookmark}: ${value}`);
    if (name === "CTA_REPORT") assert.ok(text.includes("september 2026") && text.includes("#99001-2026") && !text.includes("2023"), "CREATEDATE fields read the fill date");
  });
}

test("CTA_Memo: a two-line Address is two lines split by one w:br, in one run with the paragraph's formatting", async () => {
  const xml = (await entries(await fill(bytes("CTA_Memo"), MEMO)))["word/document.xml"].toString("utf8");
  assert.equal(
    between(xml, "Address"),
    '<w:r><w:rPr><w:sz w:val="24"/></w:rPr><w:t xml:space="preserve">1 Test St</w:t><w:br/><w:t xml:space="preserve">Suite 2</w:t></w:r>',
  );
  // An empty bookmark after a run takes that run's formatting (Atty follows a tab run set in 12pt).
  assert.equal(between(xml, "Atty"), '<w:r><w:rPr><w:bCs/><w:sz w:val="24"/></w:rPr><w:t xml:space="preserve">Pat Example, Esq.</w:t></w:r>');
  // The title's & and < are escaped in the file, never raw.
  assert.ok(between(xml, "TitleCaption").includes("Example &amp; Sons &lt;LLP&gt; v. &quot;Sample&quot; Co&apos;s Widgets"));
  assert.ok(!xml.includes("<LLP>"));
});

test("a bookmark that already holds text: the placeholder is replaced, its formatting and neighbours kept", async () => {
  const before = (await entries(bytes("CTA_REPORT")))["word/document.xml"].toString("utf8");
  const xml = (await entries(await fill(bytes("CTA_REPORT"), { CaseID: "99001" })))["word/document.xml"].toString("utf8");
  assert.equal(textOf(between(before, "CaseID")), "number");
  assert.equal(between(xml, "CaseID"), '<w:r><w:rPr><w:b/><w:caps/></w:rPr><w:t xml:space="preserve">99001</w:t></w:r>');
  // Only that bookmark's content changed.
  const cut = (x) => withoutDateResults(x.replace(between(x, "CaseID"), ""));
  assert.equal(cut(xml), cut(before));
  // Title shares its paragraph with a Word-internal bookmark whose end marker sits inside it: that marker survives.
  const titled = (await entries(await fill(bytes("CTA_REPORT"), { Title: "A & B" })))["word/document.xml"].toString("utf8");
  assert.match(between(titled, "Title"), /^<w:r>.*<\/w:r><w:bookmarkEnd w:id="0"\/>$/);
});

test("bookmarks not in the map are left exactly as they are; an empty map changes nothing in document.xml but the date fields", async () => {
  for (const name of Object.keys(CASES)) {
    const before = await entries(bytes(name));
    const after = await entries(await fill(bytes(name), {}));
    if (name === "CTA_REPORT") assert.equal(withoutDateResults(after["word/document.xml"].toString("utf8")), withoutDateResults(before["word/document.xml"].toString("utf8")));
    else assert.ok(before["word/document.xml"].equals(after["word/document.xml"]), `${name} document.xml untouched`);
  }
  const before = (await entries(bytes("CTA_REPORT")))["word/document.xml"].toString("utf8");
  const xml = (await entries(await fill(bytes("CTA_REPORT"), CASES.CTA_REPORT.values)))["word/document.xml"].toString("utf8");
  for (const hand of ["cvs", "PutConferenceHere"]) assert.equal(between(xml, hand), between(before, hand), hand);
});

test("an empty value clears the placeholder and adds no run; a blank line in the middle is kept", async () => {
  const xml = (await entries(await fill(bytes("File_Review_Summary"), { CaseTitle: "", CaseID: "a\n\nb" })))["word/document.xml"].toString("utf8");
  assert.equal(between(xml, "CaseTitle"), "");
  assert.equal(textOf(between(xml, "CaseID")), "a\n\nb");
  assertWellFormed(xml, "empty value");
});

test("control characters that XML cannot carry are dropped, not written", async () => {
  const xml = (await entries(await fill(bytes("CTA_Memo"), { Firm: "Exa\u0000mple\u000b Firm\r\nFloor 2" })))["word/document.xml"].toString("utf8");
  assert.equal(textOf(between(xml, "Firm")), "Example Firm\nFloor 2");
  assertWellFormed(xml, "control chars");
});

test("a map name the template does not have throws UnknownBookmarkError naming it", async () => {
  await assert.rejects(fill(bytes("Inspection_Plan"), { CaseTitle: "x" }), (e) => e instanceof UnknownBookmarkError && e.name === "UnknownBookmarkError" && e.bookmark === "CaseTitle" && /CaseTitle/.test(e.message));
  await assert.rejects(fill(bytes("CTA_Memo"), { ...MEMO, Nope: "x" }), UnknownBookmarkError);
});

/** A copy of a real template with one entry rewritten — for shapes the four templates do not have. */
async function variant(name, edit) {
  const zip = await JSZip.loadAsync(bytes(name));
  await edit(zip);
  return zip.generateAsync({ type: "uint8array" });
}

test("an attached-template relationship is removed, and settings.xml no longer points at it", async () => {
  const REL = '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/attachedTemplate" Target="file:///C:\\Templates\\Example.dotm" TargetMode="External"/>';
  const KEEP = '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/mailMergeSource" Target="x" TargetMode="External"/>';
  const src = await variant("CTA_Memo", async (zip) => {
    zip.file("word/_rels/settings.xml.rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${REL}${KEEP}</Relationships>`);
    const settings = await zip.file("word/settings.xml").async("string");
    zip.file("word/settings.xml", settings.replace(/(<w:settings\b[^>]*>)/, '$1<w:attachedTemplate r:id="rId1"/>'));
  });
  const before = await entries(src);
  assert.ok(before["word/settings.xml"].toString("utf8").includes("<w:attachedTemplate"), "fixture has the reference");
  const after = await entries(await fill(src, MEMO));
  const rels = after["word/_rels/settings.xml.rels"].toString("utf8");
  assert.ok(!rels.includes("attachedTemplate"), "relationship gone");
  assert.ok(rels.includes(KEEP), "other relationships kept");
  assertWellFormed(rels, "settings rels");
  const settings = after["word/settings.xml"].toString("utf8");
  assert.ok(!settings.includes("attachedTemplate"), "settings reference gone");
  assert.equal(settings, before["word/settings.xml"].toString("utf8").replace('<w:attachedTemplate r:id="rId1"/>', ""), "nothing else in settings moved");
  assertWellFormed(settings, "settings");
});

test("shapes the engine does not handle throw UnsupportedTemplateError instead of writing broken XML", async () => {
  const doc = (edit) => (zip) => zip.file("word/document.xml").async("string").then((x) => zip.file("word/document.xml", edit(x)));
  // A bookmark whose end marker is in a later paragraph.
  const spans = await variant("File_Review_Summary", doc((x) => {
    const at = x.indexOf('w:name="CaseID"');
    const tail = x.slice(at).replace('<w:bookmarkEnd w:id="0"/>', "").replace(/<\/w:p><w:p\b[^>]*>/, '$&<w:bookmarkEnd w:id="0"/>');
    assert.ok(tail.indexOf('<w:bookmarkEnd w:id="0"/>') > tail.indexOf("</w:p>"), "fixture: end marker now in the next paragraph");
    return x.slice(0, at) + tail;
  }));
  await assert.rejects(fill(spans, { CaseID: "1" }), UnsupportedTemplateError);
  // A bookmark wrapping a field.
  const field = await variant("File_Review_Summary", doc((x) => x.replace("<w:t>xxx</w:t>", '<w:fldChar w:fldCharType="begin"/>')));
  await assert.rejects(fill(field, { CaseID: "1" }), UnsupportedTemplateError);
  // A bookmark with no end marker.
  const open = await variant("File_Review_Summary", doc((x) => x.replace('<w:bookmarkEnd w:id="0"/>', "")));
  await assert.rejects(fill(open, { CaseID: "1" }), UnsupportedTemplateError);
  // Not a template at all (already a document), and not a zip.
  const docx = await fill(bytes("CTA_Memo"), {});
  await assert.rejects(fill(docx, {}), UnsupportedTemplateError);
  await assert.rejects(fill(new Uint8Array([1, 2, 3]), {}));
});

test("the same input gives the same bytes", async () => {
  const a = await fill(bytes("CTA_Memo"), MEMO);
  const b = await fill(bytes("CTA_Memo"), MEMO);
  assert.ok(Buffer.from(a).equals(Buffer.from(b)));
  // Rewritten entries keep the template's timestamps, so the bytes do not depend on the clock.
  const [src, out] = await Promise.all([JSZip.loadAsync(bytes("CTA_Memo")), JSZip.loadAsync(a)]);
  for (const path of CHANGED.slice(0, 3)) assert.equal(out.file(path).date.getTime(), src.file(path).date.getTime(), path);
});

test("templates.ts matches the .dotx files on disk (regenerate: node lib/case-docs/gen-templates.mjs)", () => {
  const onDisk = readdirSync(DIR).filter((f) => f.endsWith(".dotx")).map((f) => f.slice(0, -5)).sort();
  assert.deepEqual(Object.keys(TEMPLATE_DOTX).sort(), onDisk, "one entry per .dotx file");
  assert.deepEqual(onDisk, Object.keys(CASES).sort(), "this suite covers every template");
  for (const name of onDisk) assert.ok(Buffer.from(TEMPLATE_DOTX[name], "base64").equals(readFileSync(new URL(`${name}.dotx`, DIR))), `${name} drifted from its .dotx`);
});

test("fill.ts is bytes in, bytes out: it imports jszip and nothing else, and neither module reads a file", () => {
  const fill = readFileSync(new URL("../../lib/case-docs/fill.ts", import.meta.url), "utf8");
  assert.deepEqual([...fill.matchAll(/^import .* from "([^"]+)";$/gm)].map((m) => m[1]), ["jszip"]);
  const gen = readFileSync(new URL("../../lib/case-docs/templates.ts", import.meta.url), "utf8");
  for (const src of [fill, gen]) assert.ok(!/\bfrom "(node:)?fs|require\(|readFile|process\.env|import\(/.test(src), "no fs / env / dynamic import");
});

test("CTA_REPORT: both CREATEDATE fields show the fill date in their own formatting; no 2023 left in the text", async () => {
  const before = (await entries(bytes("CTA_REPORT")))["word/document.xml"].toString("utf8");
  const xml = (await entries(await fill(bytes("CTA_REPORT"), CASES.CTA_REPORT.values)))["word/document.xml"].toString("utf8");
  const was = dateFields(before), now = dateFields(xml);
  assert.deepEqual(was.map((f) => [f.picture, textOf(f.result)]), [["YYYY", "2023"], ["MMMM YYYY", "November 2020"]], "fixture: the template's stale results");
  assert.deepEqual(now.map((f) => [f.picture, textOf(f.result)]), [["YYYY", "2026"], ["MMMM YYYY", "September 2026"]]);
  now.forEach((f, i) => assert.equal(f.result, `<w:r>${/<w:rPr>.*?<\/w:rPr>/.exec(was[i].result)[0]}<w:t xml:space="preserve">${textOf(f.result)}</w:t></w:r>`, "one run, the cached result's rPr"));
  assert.ok(!textOf(xml).includes("2023"), "no 2023 anywhere in the document text");
  assertWellFormed(xml, "CTA_REPORT dated");
});

test("docProps/core.xml: created and modified are now (UTC, to the minute) for all four; nothing else in it moves", async () => {
  for (const name of Object.keys(CASES)) {
    const before = (await entries(bytes(name)))["docProps/core.xml"].toString("utf8");
    const core = (await entries(await fill(bytes(name), CASES[name].values)))["docProps/core.xml"].toString("utf8");
    assert.deepEqual(coreDates(core), ["2026-09-30T15:00:00Z", "2026-09-30T15:00:00Z"], name);
    const [c, m] = coreDates(before);
    assert.equal(core, before.replace(`>${c}<`, ">2026-09-30T15:00:00Z<").replace(`>${m}<`, ">2026-09-30T15:00:00Z<"), `${name}: only the two dates`);
    assertWellFormed(core, `${name} core.xml`);
  }
});

for (const TZ of ["UTC", "America/Los_Angeles"]) {
  test(`TZ=${TZ}: 03:30 UTC Jan 1 2027 (Dec 31 in New York) → December 2026 / 2026, core.xml 2027-01-01T03:30:00Z`, () => {
    const at = Date.UTC(2027, 0, 1, 3, 30);
    // The route's call: fillTemplate(..., now, firmToday(now)).
    const code = `
      const f = await import(${JSON.stringify(fileURLToPath(new URL("../../lib/case-docs/fill.ts", import.meta.url)))});
      const p = await import(${JSON.stringify(fileURLToPath(new URL("../../lib/cases/presets.ts", import.meta.url)))});
      const t = await import(${JSON.stringify(fileURLToPath(new URL("../../lib/case-docs/templates.ts", import.meta.url)))});
      const { fillTemplate } = f.fillTemplate ? f : f.default, { firmToday } = p.firmToday ? p : p.default, { TEMPLATE_DOTX } = t.TEMPLATE_DOTX ? t : t.default;
      const now = new Date(${at});
      const out = await fillTemplate(Buffer.from(TEMPLATE_DOTX.CTA_REPORT, "base64"), {}, now, firmToday(now));
      process.stdout.write(JSON.stringify({ local: now.getFullYear(), docx: Buffer.from(out).toString("base64") }));`;
    const r = spawnSync(TSX, ["--input-type=module", "-e", code], { env: { ...process.env, TZ }, encoding: "utf8", maxBuffer: 64 << 20 });
    assert.equal(r.status, 0, r.stderr);
    const out = JSON.parse(r.stdout);
    assert.equal(out.local, TZ === "UTC" ? 2027 : 2026, "child really runs in that TZ");
    return entries(Buffer.from(out.docx, "base64")).then((e) => {
      assert.deepEqual(dateFields(e["word/document.xml"].toString("utf8")).map((f) => textOf(f.result)), ["2026", "December 2026"]);
      assert.deepEqual(coreDates(e["docProps/core.xml"].toString("utf8")), ["2027-01-01T03:30:00Z", "2027-01-01T03:30:00Z"]);
    });
  });
}

test("a CREATEDATE with any other picture, a simple CREATEDATE field, or a bad firmDate throws — never a stale date", async () => {
  const doc = (edit) => (zip) => zip.file("word/document.xml").async("string").then((x) => zip.file("word/document.xml", edit(x)));
  const other = await variant("CTA_REPORT", doc((x) => x.replace('CREATEDATE  \\@ "YYYY"', 'CREATEDATE  \\@ "MMMM d, yyyy"')));
  await assert.rejects(fill(other, {}), (e) => e instanceof UnsupportedTemplateError && /MMMM d, yyyy/.test(e.message));
  const bare = await variant("CTA_REPORT", doc((x) => x.replace('CREATEDATE  \\@ "YYYY"', "CREATEDATE")));
  await assert.rejects(fill(bare, {}), UnsupportedTemplateError);
  const simple = await variant("CTA_Memo", doc((x) => x.replace(/(<w:body>)/, '$1<w:p><w:fldSimple w:instr=" CREATEDATE \\@ &quot;YYYY&quot; "><w:r><w:t>2023</w:t></w:r></w:fldSimple></w:p>')));
  await assert.rejects(fill(simple, {}), UnsupportedTemplateError);
  // Other field types (PAGE, PAGEREF, TOC) are never touched: the empty-map test compares everything but the two date results.
  await assert.rejects(fillTemplate(bytes("CTA_Memo"), {}, NOW, "09/30/2026"), TypeError);
});
