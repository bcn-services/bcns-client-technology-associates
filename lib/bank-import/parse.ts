import { parseMoney } from "../funds/money";

/** One parsed export line. `amount` is a signed fixed 2-decimal string (negative = outflow); never a float. */
export type BankRow = { line: number; postedon: string; description: string; amount: string };
export type ParseResult = { ok: true; rows: BankRow[] } | { ok: false; errors: string[] };

const HEADER = ["date", "description", "amount"];

/** Split one CSV line. Quoted fields may hold commas and `""` escapes. null = unterminated/stray quote. */
export function splitCsvLine(line: string): string[] | null {
  const out: string[] = [];
  let i = 0;
  for (;;) {
    let field = "";
    if (line[i] === '"') {
      i++;
      for (;;) {
        if (i >= line.length) return null; // unterminated quote
        if (line[i] === '"') {
          if (line[i + 1] === '"') { field += '"'; i += 2; continue; }
          i++;
          break;
        }
        field += line[i++];
      }
      if (i < line.length && line[i] !== ",") return null; // text after a closing quote
    } else {
      const end = line.indexOf(",", i);
      field = end === -1 ? line.slice(i) : line.slice(i, end);
      if (field.includes('"')) return null;
      i = end === -1 ? line.length : end;
    }
    out.push(field);
    if (i >= line.length) return out;
    i++; // skip the comma
  }
}

/** "2026-01-15" or BoA's "01/15/2026" → "2026-01-15"; impossible dates (2026-02-30) → null. */
export function parseDate(raw: string): string | null {
  const s = raw.trim();
  let m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  let y: number, mo: number, d: number;
  if (m) [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  else if ((m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s))) [y, mo, d] = [Number(m[3]), Number(m[1]), Number(m[2])];
  else return null;
  const t = new Date(Date.UTC(y, mo - 1, d));
  if (t.getUTCFullYear() !== y || t.getUTCMonth() !== mo - 1 || t.getUTCDate() !== d) return null;
  return `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/**
 * Parse a BoA checking/savings export. The header is the first line whose cells include Date, Description and Amount
 * (any case/order; extra columns like "Running Bal." ignored); everything above it is BoA's summary preamble, skipped.
 * Whole file first: any bad line → every error (physical file line numbers) and no rows, so the caller can refuse the
 * file all-or-nothing. BOM, CRLF and blank lines tolerated. BoA's "Beginning balance as of …" row (empty amount) is
 * skipped; any other empty amount stays an error.
 */
export function parseBoaCsv(text: string): ParseResult {
  const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/);
  const errors: string[] = [];
  const rows: BankRow[] = [];
  let h = -1;
  let width = 0;
  let col: number[] = [];
  for (let i = 0; i < lines.length && h < 0; i++) {
    const cells = (splitCsvLine(lines[i]!) ?? []).map((c) => c.trim().toLowerCase());
    col = HEADER.map((name) => cells.indexOf(name));
    if (col.every((c) => c >= 0)) [h, width] = [i, cells.length];
  }
  if (h < 0) return { ok: false, errors: ["No header row found: expected columns Date, Description, Amount"] };
  const [di, dsi, ai] = col as [number, number, number];
  for (let i = h + 1; i < lines.length; i++) {
    const raw = lines[i]!;
    if (raw.trim() === "") continue;
    const n = i + 1;
    const f = splitCsvLine(raw);
    if (!f) { errors.push(`Line ${n}: unbalanced quotes`); continue; }
    if (f.length !== width) { errors.push(`Line ${n}: expected ${width} fields, found ${f.length}`); continue; }
    const description = f[dsi]!.trim();
    if (f[ai]!.trim() === "" && /^beginning balance as of\b/i.test(description)) continue;
    const postedon = parseDate(f[di]!);
    const amount = parseMoney(f[ai]!);
    if (!postedon) errors.push(`Line ${n}: bad date "${f[di]!.trim()}"`);
    if (!amount) errors.push(`Line ${n}: bad amount "${f[ai]!.trim()}"`);
    if (!description) errors.push(`Line ${n}: missing description`);
    if (postedon && amount && description) rows.push({ line: n, postedon, description, amount });
  }
  return errors.length ? { ok: false, errors } : { ok: true, rows };
}
