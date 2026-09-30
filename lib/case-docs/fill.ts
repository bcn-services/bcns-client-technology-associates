/**
 * Fill engine for the legacy case documents: `.dotx` template bytes + bookmark name → text, out come `.docx` bytes.
 * Bytes in, bytes out — no database, storage or Next imports. What it changes, and nothing else:
 *   1. `[Content_Types].xml`: the main part's type, template → document (that is all that makes a .dotx a .docx).
 *   2. `word/document.xml`: for each named bookmark, the runs between its start and end markers become ONE run holding
 *      the escaped text (newlines as `w:br`). Both markers stay, as does any other bookmark's marker sitting between them.
 *   3. The attached-template relationship, if the template has one (legacy: `AttachedTemplate = ""`).
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

function fillBookmark(xml: string, name: string, text: string): string {
  const mark = findBookmark(xml, name);
  if (!mark) throw new UnknownBookmarkError(name);
  const between = xml.slice(mark.from, mark.to);
  const runs = between.match(RUN) ?? [];
  if (between.replace(RUN, "").replace(MARKERS, "") !== "" || runs.some((r) => !PLAIN_RUN_BODY.test(r.replace(/^<w:r[^>]*>/, "").replace(/<\/w:r>$/, "").replace(RPR, "")))) {
    throw new UnsupportedTemplateError(`Bookmark "${name}" holds more than plain text in one paragraph`);
  }
  const first = runs[0];
  const rPr = first !== undefined ? RPR.exec(first)?.[0] ?? "" : formattingBefore(xml, mark.from, name);
  const body = text
    .split(/\r\n|\r|\n/)
    .map((line) => (line === "" ? "" : `<w:t xml:space="preserve">${escapeXml(line)}</w:t>`))
    .join("<w:br/>");
  const run = body === "" ? "" : `<w:r>${rPr}${body}</w:r>`;
  const at = runs.length ? between.search(RUN) : 0;
  return xml.slice(0, mark.from) + between.slice(0, at) + run + between.slice(at).replace(RUN, "") + xml.slice(mark.to);
}

/**
 * `template`: a `.dotx` file's bytes. `values`: bookmark name → text. Returns `.docx` bytes.
 * A bookmark not named in `values` is left exactly as it is; a name the template lacks throws UnknownBookmarkError.
 */
export async function fillTemplate(template: Uint8Array, values: Readonly<Record<string, string>>): Promise<Uint8Array> {
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
  write("word/document.xml", doc);

  const RELS = "word/_rels/settings.xml.rels";
  const ATTACHED = /<Relationship\b[^>]*\bType="[^"]*\/attachedTemplate"[^>]*\/>/g;
  const rels = zip.file(RELS) ? await read(RELS) : "";
  if (ATTACHED.test(rels)) {
    write(RELS, rels.replace(ATTACHED, ""));
    write("word/settings.xml", (await read("word/settings.xml")).replace(/<w:attachedTemplate\b[^>]*\/>/g, ""));
  }

  return zip.generateAsync({ type: "uint8array", compression: "DEFLATE" });
}
