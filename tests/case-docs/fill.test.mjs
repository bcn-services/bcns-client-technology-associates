// Item 1 fill engine (unit): fillTemplate (lib/case-docs/fill.ts) against the four real templates, read from the
// generated base64 module (lib/case-docs/templates.ts) — the only source the app has at runtime.
// Every filled value is invented; nothing here is a real attorney, firm, address or case.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, writeFileSync, mkdtempSync, existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import JSZip from "jszip";

const { fillTemplate, UnknownBookmarkError, UnsupportedTemplateError } = await import("../../lib/case-docs/fill.ts");
const { TEMPLATE_DOTX } = await import("../../lib/case-docs/templates.ts");

const DIR = new URL("../../lib/case-docs/templates/", import.meta.url);
const TEMPLATE_TYPE = "application/vnd.openxmlformats-officedocument.wordprocessingml.template.main+xml";
const DOCUMENT_TYPE = "application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml";
const CHANGED = ["[Content_Types].xml", "word/document.xml", "word/_rels/settings.xml.rels"];

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
    const after = await entries(await fillTemplate(bytes(name), values));
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
    const xml = (await entries(await fillTemplate(bytes(name), values)))["word/document.xml"].toString("utf8");
    for (const [bookmark, value] of Object.entries(values)) assert.equal(textOf(between(xml, bookmark)), value, bookmark);
  });

  test(`${name}: textutil reads the filled file and finds every value and the boilerplate`, { skip: existsSync("/usr/bin/textutil") ? false : "textutil is macOS-only — not present here" }, async () => {
    const file = join(mkdtempSync(join(tmpdir(), "case-docs-")), `${name}.docx`);
    writeFileSync(file, await fillTemplate(bytes(name), values));
    const r = spawnSync("/usr/bin/textutil", ["-convert", "txt", "-stdout", file], { encoding: "utf8" });
    assert.equal(r.status, 0, r.stderr);
    const flat = (s) => s.replace(/\s+/g, " ").toLowerCase(); // w:br comes back as a line separator; w:caps text may be upper-cased
    const text = flat(r.stdout);
    assert.ok(text.includes(flat(CASES[name].boilerplate)), `boilerplate "${CASES[name].boilerplate}"`);
    for (const [bookmark, value] of Object.entries(values)) assert.ok(text.includes(flat(value)), `${bookmark}: ${value}`);
  });
}

test("CTA_Memo: a two-line Address is two lines split by one w:br, in one run with the paragraph's formatting", async () => {
  const xml = (await entries(await fillTemplate(bytes("CTA_Memo"), MEMO)))["word/document.xml"].toString("utf8");
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
  const xml = (await entries(await fillTemplate(bytes("CTA_REPORT"), { CaseID: "99001" })))["word/document.xml"].toString("utf8");
  assert.equal(textOf(between(before, "CaseID")), "number");
  assert.equal(between(xml, "CaseID"), '<w:r><w:rPr><w:b/><w:caps/></w:rPr><w:t xml:space="preserve">99001</w:t></w:r>');
  // Only that bookmark's content changed.
  const cut = (x) => x.replace(between(x, "CaseID"), "");
  assert.equal(cut(xml), cut(before));
  // Title shares its paragraph with a Word-internal bookmark whose end marker sits inside it: that marker survives.
  const titled = (await entries(await fillTemplate(bytes("CTA_REPORT"), { Title: "A & B" })))["word/document.xml"].toString("utf8");
  assert.match(between(titled, "Title"), /^<w:r>.*<\/w:r><w:bookmarkEnd w:id="0"\/>$/);
});

test("bookmarks not in the map are left exactly as they are; an empty map changes only the content type", async () => {
  for (const name of Object.keys(CASES)) {
    const before = await entries(bytes(name));
    const after = await entries(await fillTemplate(bytes(name), {}));
    assert.ok(before["word/document.xml"].equals(after["word/document.xml"]), `${name} document.xml untouched`);
  }
  const before = (await entries(bytes("CTA_REPORT")))["word/document.xml"].toString("utf8");
  const xml = (await entries(await fillTemplate(bytes("CTA_REPORT"), CASES.CTA_REPORT.values)))["word/document.xml"].toString("utf8");
  for (const hand of ["cvs", "PutConferenceHere"]) assert.equal(between(xml, hand), between(before, hand), hand);
});

test("an empty value clears the placeholder and adds no run; a blank line in the middle is kept", async () => {
  const xml = (await entries(await fillTemplate(bytes("File_Review_Summary"), { CaseTitle: "", CaseID: "a\n\nb" })))["word/document.xml"].toString("utf8");
  assert.equal(between(xml, "CaseTitle"), "");
  assert.equal(textOf(between(xml, "CaseID")), "a\n\nb");
  assertWellFormed(xml, "empty value");
});

test("control characters that XML cannot carry are dropped, not written", async () => {
  const xml = (await entries(await fillTemplate(bytes("CTA_Memo"), { Firm: "Exa\u0000mple\u000b Firm\r\nFloor 2" })))["word/document.xml"].toString("utf8");
  assert.equal(textOf(between(xml, "Firm")), "Example Firm\nFloor 2");
  assertWellFormed(xml, "control chars");
});

test("a map name the template does not have throws UnknownBookmarkError naming it", async () => {
  await assert.rejects(fillTemplate(bytes("Inspection_Plan"), { CaseTitle: "x" }), (e) => e instanceof UnknownBookmarkError && e.name === "UnknownBookmarkError" && e.bookmark === "CaseTitle" && /CaseTitle/.test(e.message));
  await assert.rejects(fillTemplate(bytes("CTA_Memo"), { ...MEMO, Nope: "x" }), UnknownBookmarkError);
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
  const after = await entries(await fillTemplate(src, MEMO));
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
  await assert.rejects(fillTemplate(spans, { CaseID: "1" }), UnsupportedTemplateError);
  // A bookmark wrapping a field.
  const field = await variant("File_Review_Summary", doc((x) => x.replace("<w:t>xxx</w:t>", '<w:fldChar w:fldCharType="begin"/>')));
  await assert.rejects(fillTemplate(field, { CaseID: "1" }), UnsupportedTemplateError);
  // A bookmark with no end marker.
  const open = await variant("File_Review_Summary", doc((x) => x.replace('<w:bookmarkEnd w:id="0"/>', "")));
  await assert.rejects(fillTemplate(open, { CaseID: "1" }), UnsupportedTemplateError);
  // Not a template at all (already a document), and not a zip.
  const docx = await fillTemplate(bytes("CTA_Memo"), {});
  await assert.rejects(fillTemplate(docx, {}), UnsupportedTemplateError);
  await assert.rejects(fillTemplate(new Uint8Array([1, 2, 3]), {}));
});

test("the same input gives the same bytes", async () => {
  const a = await fillTemplate(bytes("CTA_Memo"), MEMO);
  const b = await fillTemplate(bytes("CTA_Memo"), MEMO);
  assert.ok(Buffer.from(a).equals(Buffer.from(b)));
  // Rewritten entries keep the template's timestamps, so the bytes do not depend on the clock.
  const [src, out] = await Promise.all([JSZip.loadAsync(bytes("CTA_Memo")), JSZip.loadAsync(a)]);
  for (const path of CHANGED.slice(0, 2)) assert.equal(out.file(path).date.getTime(), src.file(path).date.getTime(), path);
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
