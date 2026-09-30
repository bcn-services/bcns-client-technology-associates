/**
 * Fill engine for the legacy case documents: `.dotx` template bytes + bookmark name → text, out come `.docx` bytes.
 * Bytes in, bytes out — no database, storage or Next imports. What it changes, and nothing else:
 *   1. `[Content_Types].xml`: the main part's type, template → document (that is all that makes a .dotx a .docx).
 *   2. `word/document.xml`: for each named bookmark, the runs between its start and end markers become ONE run holding
 *      the escaped text (newlines as `w:br`). Both markers stay, as does any other bookmark's marker sitting between them.
 *      Then every CREATEDATE field's cached result becomes the firm's date (see refreshCreateDate).
 *   3. The attached-template relationship, if the template has one (legacy: `AttachedTemplate = ""`).
 *   4. `docProps/core.xml`: created and modified become `now` — a new document, as Documents.Add made.
 * Run formatting: the first replaced run's `w:rPr`; for an empty bookmark, the run just before it in the paragraph
 * (what Word gives text typed there), else the paragraph mark's.
 *
 * ponytail: string surgery, not an XML parser — it handles the shapes the four templates have (a bookmark holding
 * nothing, or plain text runs, inside one paragraph) and throws UnsupportedTemplateError for anything else (a bookmark
 * spanning paragraphs, or wrapping a field/image/hyperlink). Add a real parser when a template needs one of those.
 */
import JSZip from "jszip";

export class UnknownBookmarkError extends Error {
  constructor(readonly bookmark: string) {
    super(`Template has no bookmark named "${bookmark}"`);
    this.name = "UnknownBookmarkError";
  }
}

export class UnsupportedTemplateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnsupportedTemplateError";
  }
}

const TEMPLATE_TYPE = "application/vnd.openxmlformats-officedocument.wordprocessingml.template.main+xml";
const DOCUMENT_TYPE = "application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml";

const RUN = /<w:r(?: [^>]*)?>[\s\S]*?<\/w:r>/g; // `<w:r>` / `<w:r attrs>` — never `<w:rPr>`
const RPR = /<w:rPr>[\s\S]*?<\/w:rPr>/;
const MARKERS = /<w:(?:bookmarkStart|bookmarkEnd|proofErr)\b[^>]*\/>/g;
/** What a replaceable run may hold besides its rPr: text, tabs, breaks. Fields, images, footnote refs are refused. */
const PLAIN_RUN_BODY = /^(?:<w:t(?: [^>]*)?>[^<]*<\/w:t>|<w:(?:t|tab|br|cr|lastRenderedPageBreak)\b[^>]*\/>)*$/;
// Characters XML 1.0 cannot carry at all, even escaped (tab is fine; newlines are split out before this runs).
const XML_ILLEGAL = /[^\t\x20-퟿-�\u{10000}-\u{10FFFF}]/gu;

const ESCAPES: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" };
const escapeXml = (s: string) => s.replace(XML_ILLEGAL, "").replace(/[&<>"']/g, (c) => ESCAPES[c] ?? c);

function findBookmark(xml: string, name: string): { from: number; to: number } | null {
  for (const m of xml.matchAll(/<w:bookmarkStart\b[^>]*\/>/g)) {
    if (/\bw:name="([^"]*)"/.exec(m[0])?.[1] !== name) continue;
    const id = /\bw:id="(\d+)"/.exec(m[0])?.[1];
    const from = m.index + m[0].length;
    const end = id === undefined ? null : new RegExp(`<w:bookmarkEnd\\b[^>]*\\bw:id="${id}"[^>]*/>`).exec(xml.slice(from));
    if (!end) throw new UnsupportedTemplateError(`Bookmark "${name}" has no matching end marker`);
    return { from, to: from + end.index };
  }
  return null;
}

/** Formatting for text put into an EMPTY bookmark: the run before it in its paragraph, else the paragraph mark's. */
function formattingBefore(xml: string, at: number, name: string): string {
  const pStart = Math.max(xml.lastIndexOf("<w:p>", at), xml.lastIndexOf("<w:p ", at));
  const head = pStart < 0 ? "" : xml.slice(pStart, at);
  if (pStart < 0 || head.includes("</w:p>")) throw new UnsupportedTemplateError(`Bookmark "${name}" is not inside a paragraph`);
  const prev = head.match(RUN)?.at(-1);
  if (prev) return RPR.exec(prev)?.[0] ?? "";
  const pPr = /<w:pPr>[\s\S]*?<\/w:pPr>/.exec(head)?.[0] ?? "";
  return RPR.exec(pPr)?.[0] ?? "";
}

/** The plain text runs in `segment` become ONE run holding `text`, formatted like the first of them (else `fallback()`). */
function replaceRuns(segment: string, text: string, what: string, fallback: () => string): string {
  const runs = segment.match(RUN) ?? [];
  if (segment.replace(RUN, "").replace(MARKERS, "") !== "" || runs.some((r) => !PLAIN_RUN_BODY.test(r.replace(/^<w:r[^>]*>/, "").replace(/<\/w:r>$/, "").replace(RPR, "")))) {
    throw new UnsupportedTemplateError(`${what} holds more than plain text in one paragraph`);
  }
  const first = runs[0];
  const rPr = first !== undefined ? RPR.exec(first)?.[0] ?? "" : fallback();
  const body = text
    .split(/\r\n|\r|\n/)
    .map((line) => (line === "" ? "" : `<w:t xml:space="preserve">${escapeXml(line)}</w:t>`))
    .join("<w:br/>");
  const run = body === "" ? "" : `<w:r>${rPr}${body}</w:r>`;
  const at = runs.length ? segment.search(RUN) : 0;
  return segment.slice(0, at) + run + segment.slice(at).replace(RUN, "");
}

function fillBookmark(xml: string, name: string, text: string): string {
  const mark = findBookmark(xml, name);
  if (!mark) throw new UnknownBookmarkError(name);
  const between = replaceRuns(xml.slice(mark.from, mark.to), text, `Bookmark "${name}"`, () => formattingBefore(xml, mark.from, name));
  return xml.slice(0, mark.from) + between + xml.slice(mark.to);
}

/**
 * CREATEDATE fields show the document's creation date. Access's Documents.Add made a NEW document, so they read
 * the day it was made; Word does not recalculate them on open, so their cached results are rewritten here from the
 * firm's date. Only the two pictures the templates use; any other CREATEDATE throws rather than keep a stale date.
 * ponytail: word/document.xml only — no template has a CREATEDATE in a header/footer; scan those parts when one does.
 */
function refreshCreateDate(xml: string, firmDate: string): string {
  if (/<w:fldSimple\b[^>]*\bw:instr="\s*CREATEDATE\b/i.test(xml)) throw new UnsupportedTemplateError("Simple CREATEDATE field is not supported");
  const [y, m] = firmDate.split("-");
  const shown: Record<string, string> = {
    YYYY: y!,
    "MMMM YYYY": `${new Date(Date.UTC(Number(y), Number(m) - 1)).toLocaleString("en-US", { month: "long", timeZone: "UTC" })} ${y}`,
  };
  let out = "", last = 0;
  for (const ins of xml.matchAll(/<w:instrText\b[^>]*>([^<]*)<\/w:instrText>/g)) {
    if (!/^\s*CREATEDATE\b/i.test(ins[1]!)) continue;
    const picture = /\\@\s*"([^"]*)"/.exec(ins[1]!)?.[1] ?? "";
    const text = shown[picture];
    if (text === undefined) throw new UnsupportedTemplateError(`CREATEDATE field with picture "${picture}" is not supported`);
    const after = ins.index + ins[0].length;
    const sep = xml.indexOf('w:fldCharType="separate"', after), end = xml.indexOf('w:fldCharType="end"', after);
    const from = xml.indexOf("</w:r>", sep) + "</w:r>".length;
    const to = Math.max(xml.lastIndexOf("<w:r>", end), xml.lastIndexOf("<w:r ", end));
    if (sep < 0 || end < sep || to < from || xml.slice(after, to).split("<w:fldChar").length !== 2) {
      throw new UnsupportedTemplateError("CREATEDATE field is not a plain begin/instr/separate/result/end field");
    }
    out += xml.slice(last, from) + replaceRuns(xml.slice(from, to), text, "CREATEDATE result", () => "");
    last = to;
  }
  return out + xml.slice(last);
}

/**
 * `template`: a `.dotx` file's bytes. `values`: bookmark name → text. Returns `.docx` bytes.
 * A bookmark not named in `values` is left exactly as it is; a name the template lacks throws UnknownBookmarkError.
 * `now` / `firmDate` (`YYYY-MM-DD`, the firm's today for `now` — firmToday(now)): the new document's creation moment,
 * stamped into docProps/core.xml (UTC) and shown by CREATEDATE fields (firm date), as Access's Documents.Add did.
 */
export async function fillTemplate(template: Uint8Array, values: Readonly<Record<string, string>>, now: Date, firmDate: string): Promise<Uint8Array> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(firmDate)) throw new TypeError(`firmDate must be YYYY-MM-DD, got "${firmDate}"`);
  const zip = await JSZip.loadAsync(template);
  const read = async (path: string) => {
    const entry = zip.file(path);
    if (!entry) throw new UnsupportedTemplateError(`Not a Word template: ${path} is missing`);
    return entry.async("string");
  };
  // Keep the entry's own timestamp so the same input always yields the same bytes.
  const write = (path: string, content: string) => zip.file(path, content, { date: zip.file(path)?.date });

  const types = await read("[Content_Types].xml");
  if (!types.includes(TEMPLATE_TYPE)) throw new UnsupportedTemplateError("Not a Word template (.dotx): main part is not the template type");
  write("[Content_Types].xml", types.replace(TEMPLATE_TYPE, DOCUMENT_TYPE));

  let doc = await read("word/document.xml");
  for (const [name, text] of Object.entries(values)) doc = fillBookmark(doc, name, text);
  write("word/document.xml", refreshCreateDate(doc, firmDate));

  const CORE = "docProps/core.xml";
  const stamp = `${now.toISOString().slice(0, 16)}:00Z`; // W3CDTF to the minute, as Word writes it
  let core = await read(CORE);
  for (const tag of ["dcterms:created", "dcterms:modified"]) {
    const re = new RegExp(`(<${tag}\\b[^>]*>)[^<]*(</${tag}>)`);
    if (!re.test(core)) throw new UnsupportedTemplateError(`${CORE} has no ${tag}`);
    core = core.replace(re, `$1${stamp}$2`);
  }
  write(CORE, core);

  const RELS = "word/_rels/settings.xml.rels";
  const ATTACHED = /<Relationship\b[^>]*\bType="[^"]*\/attachedTemplate"[^>]*\/>/g;
  const rels = zip.file(RELS) ? await read(RELS) : "";
  if (ATTACHED.test(rels)) {
    write(RELS, rels.replace(ATTACHED, ""));
    write("word/settings.xml", (await read("word/settings.xml")).replace(/<w:attachedTemplate\b[^>]*\/>/g, ""));
  }

  return zip.generateAsync({ type: "uint8array", compression: "DEFLATE" });
}
