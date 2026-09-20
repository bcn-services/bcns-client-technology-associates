// PostgREST fake for the reports engine. Deliberately different from tests/money/fakedb.mjs in two ways:
//  1. `.order()` is a NO-OP and rows come back in raw table order — fixtures are seeded scrambled, so any
//     ordering assertion on a module's output proves the MODULE sorted, never that the fake did.
//  2. `writes` counts every insert/update/delete statement, so a read-only claim is proved by a counter, not a grep.
const ID = { tblexpenses: "expid", tblfundsrcvd: "fndsid", tblexptype: "exptypeid", tblcase: "caseid", tblattorney: "attyid", tblbillingnames: "personid" };

const rx = (pattern) => {
  let out = "";
  for (let i = 0; i < pattern.length; i += 1) {
    const c = pattern[i];
    if (c === "\\") { out += (pattern[++i] ?? "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); continue; }
    if (c === "%") { out += ".*"; continue; }
    if (c === "_") { out += "."; continue; }
    out += c.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }
  return new RegExp(`^${out}$`, "i");
};


/** Split a PostgREST or-string on top-level commas (values are double-quoted). */
const splitOr = (expr) => {
  const out = [];
  let cur = "", q = false;
  for (let i = 0; i < expr.length; i += 1) {
    const c = expr[i];
    if (q && c === "\\") { cur += c + (expr[++i] ?? ""); continue; }
    if (c === '"') { q = !q; cur += c; continue; }
    if (c === "," && !q) { out.push(cur); cur = ""; continue; }
    cur += c;
  }
  out.push(cur);
  return out.filter((s) => s.length > 0);
};

const orMatch = (row, part) => {
  const m = /^([A-Za-z0-9_]+)\.([a-z]+)\.([\s\S]*)$/.exec(part.trim());
  if (!m) throw new Error(`fake: cannot parse or() element ${part}`);
  const [, col, op, rawIn] = m;
  const quoted = rawIn.startsWith('"') && rawIn.endsWith('"');
  const raw = quoted ? rawIn.slice(1, -1).replace(/\\"/g, '"') : rawIn;
  const v = row[col] ?? null;
  if (op === "is") return raw === "null" ? v === null : String(v) === raw;
  if (op === "eq") return String(v) === raw;
  if (op === "ilike") return v != null && rx(raw).test(String(v));
  throw new Error(`fake: or() supports is, eq, ilike (got ${op})`);
};

export function fakeDb(tables) {
  const self = {
    tables,
    writes: 0,       // insert + update + delete statements issued
    reads: 0,        // select statements issued
    from(table) {
      const t = (tables[table] ??= []);
      const st = { op: "select", payload: null, filters: [], offset: 0, limit: Infinity, count: false };
      const match = (r) => st.filters.every((f) => f(r));
      const run = async () => {
        if (st.op === "select") { self.reads += 1; } else { self.writes += 1; }
        if (st.op === "insert") {
          const key = ID[table];
          const made = [st.payload].flat().map((p) => ({ [key]: Math.max(0, ...t.map((r) => r[key])) + 1, ...p }));
          t.push(...made);
          return { data: made, error: null };
        }
        if (st.op === "update") { const hit = t.filter(match); for (const r of hit) Object.assign(r, st.payload); return { data: hit, error: null }; }
        if (st.op === "delete") { const hit = t.filter(match); tables[table] = t.filter((r) => !match(r)); return { data: hit, error: null }; }
        const all = t.filter(match);
        const out = all.slice(st.offset, st.offset + st.limit).map((r) => ({ ...r }));
        return st.count ? { data: out, count: all.length, error: null } : { data: out, error: null };
      };
      const b = {
        select: (_c, o) => { st.count = o?.count === "exact"; return b; },
        insert: (p) => { st.op = "insert"; st.payload = p; return b; },
        update: (p) => { st.op = "update"; st.payload = p; return b; },
        delete: () => { st.op = "delete"; return b; },
        eq: (c, v) => { st.filters.push((r) => r[c] === v); return b; },
        is: (c, v) => { st.filters.push((r) => (r[c] ?? null) === v); return b; },
        not: (c, op, v) => {
          if (op === "is") { st.filters.push((r) => (r[c] ?? null) !== v); return b; }
          if (op === "like") { const re = rx(v); st.filters.push((r) => r[c] == null || !re.test(String(r[c]))); return b; }
          throw new Error("fake: not() supports is, like");
        },
        // PostgREST or-string, as lib/cases/search.ts#orElement writes it: `col.op."value"` joined by commas.
        or: (expr) => { const ps = splitOr(expr); st.filters.push((r) => ps.some((p) => orMatch(r, p))); return b; },
        in: (c, vs) => { st.filters.push((r) => vs.includes(r[c])); return b; },
        gte: (c, v) => { st.filters.push((r) => r[c] != null && String(r[c]) >= String(v)); return b; },
        lte: (c, v) => { st.filters.push((r) => r[c] != null && String(r[c]) <= String(v)); return b; },
        gt: (c, v) => { st.filters.push((r) => r[c] != null && String(r[c]) > String(v)); return b; },
        lt: (c, v) => { st.filters.push((r) => r[c] != null && String(r[c]) < String(v)); return b; },
        ilike: (c, p) => { const re = rx(p); st.filters.push((r) => r[c] != null && re.test(String(r[c]))); return b; },
        order: () => b, // no-op on purpose; see header
        limit: (n) => { st.limit = n; return b; },
        range: (a, z) => { st.offset = a; st.limit = z - a + 1; return b; },
        then: (res, rej) => run().then(res, rej),
      };
      return b;
    },
  };
  return self;
}
