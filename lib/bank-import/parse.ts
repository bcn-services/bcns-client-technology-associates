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
 * file all-or-nothing. BOM, CRLF, blank and comma-only lines tolerated. A preamble line with a date cell plus a money
 * cell (a transaction above the header) is an error, not skipped. With a "Running Bal." column, its cell must be empty
 * or money (money on the beginning-balance row) and amounts must carry cents. BoA's "Beginning balance as of …" row (empty amount) is
 * skipped; any other empty amount stays an error.
 */
export function parseBoaCsv(text: string): ParseResult {
  const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/);
  const blank = (s: string) => /^[\s,]*$/.test(s); // Excel re-saves pad empty rows to ",,,"
  const errors: string[] = [];
  const rows: BankRow[] = [];
  let h = -1;
  let width = 0;
  let col: number[] = [];
  let bi = -1;
  for (let i = 0; i < lines.length && h < 0; i++) {
    const raw = splitCsvLine(lines[i]!) ?? [];
    const cells = raw.map((c) => c.trim().toLowerCase());
    col = HEADER.map((name) => cells.indexOf(name));
    if (col.every((c) => c >= 0)) {
      [h, width, bi] = [i, cells.length, cells.findIndex((c) => c.startsWith("running bal"))];
      continue;
    }
    const d = raw.findIndex((c) => parseDate(c));
    if (d >= 0 && raw.some((c, j) => j !== d && parseMoney(c))) errors.push(`Line ${i + 1}: transaction above the header row`);
  }
  if (h < 0) return { ok: false, errors: ["No header row found: expected columns Date, Description, Amount"] };
  const [di, dsi, ai] = col as [number, number, number];
  const isBalance = (s: string) => parseMoney(s) !== null || /^-?\$?0+(\.0{1,2})?$/.test(s); // parseMoney refuses 0
  for (let i = h + 1; i < lines.length; i++) {
    const raw = lines[i]!;
    if (blank(raw)) continue;
    const n = i + 1;
    const f = splitCsvLine(raw);
    if (!f) { errors.push(`Line ${n}: unbalanced quotes`); continue; }
    if (f.length !== width) { errors.push(`Line ${n}: expected ${width} fields, found ${f.length}`); continue; }
    const description = f[dsi]!.trim();
    const opening = f[ai]!.trim() === "" && /^beginning balance as of\b/i.test(description);
    if (bi >= 0) {
      const bal = f[bi]!.trim();
      if ((bal !== "" || opening) && !isBalance(bal)) errors.push(`Line ${n}: bad running balance "${bal}"`);
    }
    if (opening) continue;
    const postedon = parseDate(f[di]!);
    const amount = parseMoney(f[ai]!);
    if (!postedon) errors.push(`Line ${n}: bad date "${f[di]!.trim()}"`);
    // With a balance column, cents are required: an unquoted "-1,500.00" splits into "-1" + "500.00".
    if (!amount || (bi >= 0 && !/\.\d{2}$/.test(f[ai]!.trim()))) errors.push(`Line ${n}: bad amount "${f[ai]!.trim()}"`);
    if (!description) errors.push(`Line ${n}: missing description`);
    if (postedon && amount && description) rows.push({ line: n, postedon, description, amount });
  }
  return errors.length ? { ok: false, errors } : { ok: true, rows };
}
