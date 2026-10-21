// In-memory fake PostgREST client for the ticket tests: eq/in filters really evaluated, every op recorded in `calls`,
// writes in `writes`. ticket_messages.resend_email_id is unique like the real column (23505 on a repeat).
// ticket_messages.ticketid is a foreign key like the real column (23503 for an unknown ticket).
// opts.insertError makes every insert fail with that error; opts.updateError every update; opts.deleteError every delete. Also supports delete, order and range.
export function memDb(seed = {}, opts = {}) {
  const tables = structuredClone(seed);
  const calls = [];
  const writes = [];
  return {
    tables, calls, writes,
    from(table) {
      const st = { table, op: "select", filters: [], payload: null };
      calls.push(st);
      const exec = () => {
        const rows = (tables[table] ??= []);
        // Like PostgREST, a select("a, b") returns only those columns (so a field the code reads but didn't select is undefined here too).
        const project = (r) => (st.cols && st.cols !== "*" ? Object.fromEntries(st.cols.split(",").map((c) => c.trim()).map((c) => [c, r[c]])) : { ...r });
        const match = (r) => st.filters.every(([c, test]) => test(r[c]));
        if (st.op === "insert") {
          if (opts.insertError) return { data: null, error: opts.insertError };
          if (table === "ticket_messages" && !(tables.tickets ?? []).some((t) => t.id === st.payload.ticketid)) return { data: null, error: { code: "23503", message: "violates foreign key constraint ticket_messages_ticketid_fkey" } };
          const dup = table === "ticket_messages" && st.payload.resend_email_id && rows.some((r) => r.resend_email_id === st.payload.resend_email_id);
          if (dup) return { data: null, error: { code: "23505", message: "duplicate key value violates unique constraint" } };
          const id = Math.max(0, ...rows.map((r) => r.id ?? 0)) + 1;
          const row = { id, ...(table === "tickets" ? { status: "Open" } : {}), createdat: `2026-10-21T00:00:${String(id).padStart(2, "0")}Z`, ...st.payload };
          rows.push(row); writes.push(["insert", table, row]);
          // Emulates trigger ticket_reply_review (0014; proven against real Postgres in tests/foundation/ticket-reply.test.mjs):
          // an 'email' message flips its ticket to In review in the same step, not as a separate (failable) update.
          if (table === "ticket_messages" && row.author === "email") for (const t of tables.tickets ?? []) if (t.id === row.ticketid) t.status = "In review";
          return { data: [{ ...row }], error: null };
        }
        if (st.op === "update") {
          if (opts.updateError) return { data: null, error: opts.updateError };
          const hit = rows.filter(match);
          for (const r of hit) Object.assign(r, st.payload);
          if (hit.length) writes.push(["update", table, st.payload, hit.length]); // a 0-row update changes nothing, so it is not a write
          return { data: hit.map(project), error: null };
        }
        if (st.op === "delete") {
          if (opts.deleteError) return { data: null, error: opts.deleteError };
          const hit = rows.filter(match);
          tables[table] = rows.filter((r) => !hit.includes(r));
          writes.push(["delete", table, hit.length]);
          return { data: hit.map((r) => ({ ...r })), error: null };
        }
        let out = rows.filter(match).map(project);
        if (st.order) out = out.sort((a, b) => (a[st.order] > b[st.order] ? 1 : a[st.order] < b[st.order] ? -1 : 0));
        if (st.range) out = out.slice(st.range[0], st.range[1] + 1);
        return { data: out, error: null };
      };
      const b = {
        select(cols) { st.cols = cols; return b; },
        insert(p) { st.op = "insert"; st.payload = p; return b; },
        update(p) { st.op = "update"; st.payload = p; return b; },
        delete() { st.op = "delete"; return b; },
        order(c) { st.order = c; return b; },
        range(a, z) { st.range = [a, z]; return b; },
        eq(c, v) { st.filters.push([c, (x) => x === v]); return b; },
        in(c, vs) { st.filters.push([c, (x) => vs.includes(x)]); return b; },
        then(res, rej) { return Promise.resolve().then(exec).then(res, rej); },
      };
      return b;
    },
  };
}
