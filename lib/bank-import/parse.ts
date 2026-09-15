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
 * Parse a BoA `Date,Description,Amount` export. Whole file first: any bad line → every error (line-numbered,
 * header = line 1) and no rows, so the caller can refuse the file all-or-nothing. BOM, CRLF and blank lines tolerated.
 */
export function parseBoaCsv(text: string): ParseResult {
  const lines = text.replace(/^﻿/, "").split(/\r?\n/);
  const errors: string[] = [];
  const rows: BankRow[] = [];
  const head = splitCsvLine(lines[0] ?? "");
  if (!head || head.length !== 3 || head.some((h, i) => h.trim().toLowerCase() !== HEADER[i])) {
    return { ok: false, errors: ['Line 1: header must be "Date,Description,Amount"'] };
  }
  for (let i = 1; i < lines.length; i++) {
    const raw = lines[i]!;
    if (raw.trim() === "") continue;
    const n = i + 1;
    const f = splitCsvLine(raw);
    if (!f) { errors.push(`Line ${n}: unbalanced quotes`); continue; }
    if (f.length !== 3) { errors.push(`Line ${n}: expected 3 fields, found ${f.length}`); continue; }
    const postedon = parseDate(f[0]!);
    const amount = parseMoney(f[2]!);
    const description = f[1]!.trim();
    if (!postedon) errors.push(`Line ${n}: bad date "${f[0]!.trim()}"`);
    if (!amount) errors.push(`Line ${n}: bad amount "${f[2]!.trim()}"`);
    if (!description) errors.push(`Line ${n}: missing description`);
    if (postedon && amount && description) rows.push({ line: n, postedon, description, amount });
  }
  return errors.length ? { ok: false, errors } : { ok: true, rows };
}
