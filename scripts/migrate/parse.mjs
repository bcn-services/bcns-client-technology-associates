// scripts/migrate/parse.mjs — the mssql-scripter `--data-only` grammar, shared by
// load.mjs and verify.mjs. No side effects: importing this runs nothing.
// `file` is only ever used to name the source in an error message.

/** UTF-8 (BOM stripped); UTF-16 LE with BOM only when UTF-8 decoding fails. */
export function decode(buf, file = "input") {
  if (buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) return new TextDecoder("utf-8").decode(buf.subarray(3));
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(buf);
  } catch {
    if (buf[0] === 0xff && buf[1] === 0xfe) return new TextDecoder("utf-16le").decode(buf.subarray(2));
    throw new Error(`${file}: not valid UTF-8 and no UTF-16 LE BOM`);
  }
}

/** Parse the machine-generated grammar into [{table, cols, rows}]. Everything else is dropped. */
export function parse(text, file = "input") {
  const n = text.length;
  let i = 0;
  const stmts = [];
  const isWs = (c) => c === " " || c === "\t" || c === "\r" || c === "\n";
  const ws = () => { while (i < n && isWs(text[i])) i++; };
  const at = (w) => text.slice(i, i + w.length).toUpperCase() === w;
  const kw = (w) => (at(w) ? ((i += w.length), true) : false);
  const bail = (what) => { throw new Error(`${file}: expected ${what} near offset ${i}: ${JSON.stringify(text.slice(i, i + 40))}`); };

  function ident() {
    ws();
    if (text[i] === "[") { const e = text.indexOf("]", i); if (e < 0) bail("closing ]"); const v = text.slice(i + 1, e); i = e + 1; return v; }
    const s = i;
    while (i < n && /[A-Za-z0-9_$#@]/.test(text[i])) i++;
    if (i === s) bail("identifier");
    return text.slice(s, i);
  }
  function stringLit() { // text[i] === "'"
    i++;
    let out = "";
    for (;;) {
      const c = text[i];
      if (c === undefined) bail("closing quote");
      if (c === "'") {
        if (text[i + 1] === "'") { out += "'"; i += 2; continue; }
        i++; return out;
      }
      out += c; i++; // embedded newlines kept verbatim
    }
  }
  function value() {
    ws();
    if (text[i] === "'") return { k: "s", v: stringLit() };
    if ((text[i] === "N" || text[i] === "n") && text[i + 1] === "'") { i++; return { k: "s", v: stringLit() }; }
    if (at("CAST(")) { // CAST(<literal> AS <Type>) — the type is SQL Server's; Postgres casts from the target column
      i += 5;
      const inner = value();
      ws();
      if (!kw("AS")) bail("AS in CAST");
      let depth = 1;
      while (i < n && depth > 0) { if (text[i] === "(") depth++; else if (text[i] === ")") depth--; i++; }
      return inner;
    }
    const s = i;
    while (i < n && text[i] !== "," && text[i] !== ")" && !isWs(text[i])) i++;
    const tok = text.slice(s, i);
    if (tok === "") bail("value");
    return tok.toUpperCase() === "NULL" ? { k: "null" } : { k: "n", v: tok };
  }

  while (i < n) {
    ws();
    if (i >= n) break;
    if (!at("INSERT")) { while (i < n && text[i] !== "\n") i++; continue; } // USE/GO/SET .../comments
    i += 6;
    ws(); kw("INTO");
    let name = ident();
    while (text[i] === ".") { i++; name = ident(); }
    ws();
    if (text[i] !== "(") bail("column list");
    i++;
    const cols = [];
    for (;;) {
      cols.push(ident().toLowerCase());
      ws();
      if (text[i] === ",") { i++; continue; }
      if (text[i] === ")") { i++; break; }
      bail(", or ) in column list");
    }
    ws();
    if (!kw("VALUES")) bail("VALUES");
    const rows = [];
    for (;;) {
      ws();
      if (text[i] !== "(") bail("( starting a VALUES row");
      i++;
      const vals = [];
      for (;;) {
        vals.push(value());
        ws();
        if (text[i] === ",") { i++; continue; }
        if (text[i] === ")") { i++; break; }
        bail(", or ) in VALUES row");
      }
      if (vals.length !== cols.length) throw new Error(`${file}: ${name}: ${vals.length} values for ${cols.length} columns`);
      rows.push(vals);
      ws();
      if (text[i] === ",") { i++; continue; } // the multi-row VALUES (...),(...) batch form
      break;
    }
    ws();
    if (text[i] === ";") i++;
    stmts.push({ table: name.toLowerCase(), cols, rows });
  }
  return stmts;
}

export const quote = (s) => "'" + s.replace(/'/g, "''") + "'";
