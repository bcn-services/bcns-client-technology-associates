/**
 * Shared pdf-lib plumbing for the firm's documents (invoice, service authorization): Letter page, Times fonts,
 * WinAnsi-safe text, word wrap, the config letterhead, and the legacy VBA number/date formats. Pure: no DB, no clock.
 */
import { PDFDocument, StandardFonts, rgb, type PDFFont } from "pdf-lib";
import { fmtCents } from "@/lib/expenses/list";

export const INK = rgb(0.2, 0.2, 0.22);
/** Letter page in points; L = text margin, RCOL = the letterhead's right column. */
export const W = 612, H = 792, L = 58, R = 558, RCOL = 414;

/** Standard fonts are WinAnsi-only: keep what the font encodes, strip accents from the rest, else "?". Control chars → space. */
export function cleaner(font: PDFFont): (s: string) => string {
  const ok = new Set(font.getCharacterSet());
  const one = (ch: string) => (ok.has(ch.codePointAt(0)!) ? ch : null);
  return (s) => [...s.replace(/\p{Cc}/gu, " ")]
    .map((ch) => one(ch) ?? ([...ch.normalize("NFKD").replace(/\p{M}/gu, "")].map((c) => one(c) ?? "?").join("") || "?"))
    .join("");
}

/** Greedy word wrap to `width` (pass CLEANED text — the width lookup throws on non-WinAnsi); a word wider than `width` is split. */
export function wrap(font: PDFFont, size: number, s: string, width: number): string[] {
  const fits = (t: string) => font.widthOfTextAtSize(t, size) <= width;
  const out: string[] = [];
  let cur = "";
  for (let w of s.split(/\s+/).filter(Boolean)) {
    const next = cur ? `${cur} ${w}` : w;
    if (fits(next)) { cur = next; continue; }
    if (cur) out.push(cur);
    while (!fits(w) && w.length > 1) {
      let i = w.length - 1;
      while (i > 1 && !fits(w.slice(0, i))) i--;
      out.push(w.slice(0, i));
      w = w.slice(i);
    }
    cur = w;
  }
  return out.length || cur ? [...out, cur] : [""];
}

/** A new document with Times regular/bold and the WinAnsi cleaner for the regular face. */
export async function openDoc(title: string) {
  const doc = await PDFDocument.create();
  doc.setTitle(title);
  const reg = await doc.embedFont(StandardFonts.TimesRoman);
  const bold = await doc.embedFont(StandardFonts.TimesRomanBold);
  return { doc, reg, bold, clean: cleaner(reg) };
}

export type TextFn = (s: string, x: number, y: number, size?: number, font?: PDFFont) => void;

/** The legacy template letterhead: firm name bold at left, the other lines in a column at right. Returns the y below it. */
export function drawLetterhead(lines: string[] | undefined, text: TextFn, bold: PDFFont): number {
  const y = H - 58;
  const [firm, ...rest] = lines ?? [];
  if (firm) text(firm, L, y, 14, bold);
  rest.forEach((s, i) => text(s, RCOL, y - i * 13, 11));
  return y - Math.max(firm ? 16 : 0, rest.length * 13) - 22;
}

export const ymd = (d: string) => d.slice(0, 10).split("-").map(Number) as [number, number, number];
/** VBA `M/D/YY`. */
export const mdyy = (d: string | null): string => { if (!d) return ""; const [y, m, day] = ymd(d); return `${m}/${day}/${String(y % 100).padStart(2, "0")}`; };
/** VBA `#,###`: cents → whole dollars, half away from zero, with commas; 0 → "0" (VBA would print nothing). */
export const dollars = (c: number): string => fmtCents(Math.sign(c) * Math.floor((Math.abs(c) + 50) / 100) * 100).slice(0, -3);
/** VBA `Format(h, "fixed")`: thousandths → 2 decimals, half-up. */
export const fixed2 = (t: number): string => { const h = Math.floor((t + 5) / 10); return `${Math.trunc(h / 100)}.${String(h % 100).padStart(2, "0")}`; };
