// Shared stateful fake of the PostgREST subset money code uses. Filters (eq / is / not-is-null / in) are applied to
// EVERY row, so an unfiltered update/delete hits every row and a dropped-filter mutant goes red against a decoy.
// `hook(op, table, tables)` is awaited before each statement runs — tests use it to interleave concurrent requests.
const ID = { tblexpenses: "expid", bank_transactions: "id", tblexptype: "exptypeid", tblcase: "caseid", tblbills: "billid" };

export function fakeDb(tables, { hook } = {}) {
  const calls = [];
  return {
    calls, tables,
    from(table) {
      const t = (tables[table] ??= []);
      const st = { op: "select", payload: null, filters: [], limit: Infinity, one: null };
      const match = (r) => st.filters.every((f) => f(r));
      const run = async () => {
        await hook?.(st.op, table, tables);
        calls.push([st.op, table]);
        let out;
        if (st.op === "insert") {
          const key = ID[table];
          out = [st.payload].flat().map((p) => ({ [key]: Math.max(0, ...t.map((r) => r[key])) + 1, ...p }));
          t.push(...out);
        } else if (st.op === "update") {
          out = t.filter(match);
          for (const r of out) Object.assign(r, st.payload);
        } else if (st.op === "delete") {
          out = t.filter(match);
          tables[table] = t.filter((r) => !match(r));
        } else out = t.filter(match).slice(0, st.limit);
        out = out.map((r) => ({ ...r }));
        if (st.one) {
          if (st.one === "single" && out.length !== 1) return { data: null, error: { message: "not single" } };
          return { data: out[0] ?? null, error: null };
        }
        return { data: out, error: null };
      };
      const b = {
        select: () => b,
        insert: (p) => { st.op = "insert"; st.payload = p; return b; },
        update: (p) => { st.op = "update"; st.payload = p; return b; },
        delete: () => { st.op = "delete"; return b; },
        eq: (c, v) => { st.filters.push((r) => r[c] === v); return b; },
        is: (c, v) => { st.filters.push((r) => (r[c] ?? null) === v); return b; },
        not: (c, op, v) => { if (op !== "is") throw new Error("fake: not() supports is"); st.filters.push((r) => (r[c] ?? null) !== v); return b; },
        in: (c, vs) => { st.filters.push((r) => vs.includes(r[c])); return b; },
        order: () => b,
        limit: (n) => { st.limit = n; return b; },
        maybeSingle: () => { st.one = "maybe"; return b; },
        single: () => { st.one = "single"; return b; },
        then: (res, rej) => run().then(res, rej),
      };
      return b;
    },
  };
}
