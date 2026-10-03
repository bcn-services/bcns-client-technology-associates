// QA: drives the REAL runSearch/listCases (not hand-written SQL) against local Postgres through a fake
// client that translates each recorded PostgREST call (select/or/filter/in/order/range) into SQL, parsing
// `or=` strings the way PostgREST does (quoted values, backslash escapes, `*` -> `%` in like patterns).
// Seeds a private FOUNDATION_PG_URL (never ta_foundation) and truncates after. Plus one hosted PostgREST
// grammar check: hostile input in an `.or()` must not error or widen the filter.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { sql, one, resetDb, insertSql, literal, DB_URL } from "../foundation/harness.mjs";
import { rows, CASE_ID } from "../foundation/fixtures/rows.ts";
import { quickSpec, advancedSpec, runSearch, listCases } from "../../lib/cases/search.ts";

const privateDb = !/\/ta_foundation$/.test(DB_URL);
let reachable = privateDb;
const TABLES = [...new Set(rows.map(([t]) => t))];
const kase = (caseid, casetitle, extra = {}) =>
  insertSql("tblcase", { caseid, caseatty: 1, casetitle, caseclient: 1, tabranch: "Hartford", status: "Active", casestartdate: "2026-01-01", billingalert: false, ...extra });
const seed = (extra = "") => sql(`set session_replication_role = replica;
truncate ${TABLES.join(",")} cascade;
${rows.map(([t, r]) => insertSql(t, r)).join("\n")}
${insertSql("tblclient", { clientid: 2, clientfirstname: "Jo", clientlastname: "Other" })}
${kase(90002, "Orphan v. Nobody", { caseatty: 99999, caseclient: 99999, casestartdate: "2026-03-01" })}
${insertSql("tblattorney", { attyid: 2, attyfirmid: 99999, attyfirstname: "Lone", attylastname: "Wolf", attyesq: false })}
${kase(90003, "Firmless v. Case", { caseatty: 2, caseclient: 2, casestartdate: "2025-06-01" })}
${kase(91001, "Alpha v. Beta", { casestartdate: "2026-03-01" })}
${kase(91002, "Alpha v. Gamma", { caseclient: 2, casestartdate: "2026-02-01", status: "Closed" })}
${kase(91004, "100% Widgets_Co", { caseclient: 2 })}
${kase(91005, "1000 WidgetsXCo", { caseclient: 2 })}
${extra}
set session_replication_role = origin;`);
before(() => {
  if (!privateDb) return;
  try { if (one("select count(*) from information_schema.columns where table_name = 'case_search' and column_name = 'casestatduedatedescription'") !== "1") resetDb(); seed(); } catch { reachable = false; }
});
after(() => { if (reachable) sql(`truncate ${TABLES.join(",")} cascade;`); });
const live = (name, fn) => test(name, (t) => (reachable ? fn() : t.skip("needs a private local FOUNDATION_PG_URL")));

/** Split a PostgREST or= string on top-level commas; each element `col.op.value`, value maybe "quoted". */
function parseOr(s) {
  const els = []; let cur = ""; let q = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (q && ch === "\\") { cur += ch + s[++i]; continue; }
    if (ch === '"') q = !q;
    if (ch === "," && !q) { els.push(cur); cur = ""; } else cur += ch;
  }
  els.push(cur);
  return els.map((e) => {
    const m = /^([a-z_]+)\.(ilike|eq|gt)\.(.*)$/s.exec(e);
    if (!m) throw new Error(`PostgREST would reject or element: ${e}`);
    let v = m[3];
    if (v.startsWith('"')) { assert.ok(v.endsWith('"'), `unterminated quote in ${e}`); v = v.slice(1, -1).replace(/\\(.)/gs, "$1"); }
    return [m[1], m[2], v];
  });
}
const cond = ([c, o, v]) => `${c} ${o === "ilike" ? "ilike" : o === "eq" ? "=" : ">"} ${literal(o === "ilike" ? v.replaceAll("*", "%") : v)}`;

/** Fake supabase client executing against local PG. */
const pgDb = {
  from(table) {
    const q = { where: [], order: [], cols: "*", range: null };
    const b = {
      select(c) { q.cols = c; return b; },
      or(s) { q.where.push(`(${parseOr(s).map(cond).join(" or ")})`); return b; },
      filter(c, o, v) { q.where.push(cond([c, o, v])); return b; },
      in(c, ids) { q.where.push(`${c} in (${ids.map(Number).join(",") || "null"})`); return b; },
      order(c, o = {}) { q.order.push(`${c} ${o.ascending === false ? "desc" : "asc"}`); return b; },
      range(f, t) { q.range = [f, t]; return b; },
      then(res, rej) {
        return Promise.resolve().then(() => {
          const s = `select coalesce(jsonb_agg(t), '[]') from (select ${q.cols} from ${table}${q.where.length ? ` where ${q.where.join(" and ")}` : ""}${q.order.length ? ` order by ${q.order.join(", ")}` : ""}${q.range ? ` offset ${q.range[0]} limit ${q.range[1] - q.range[0] + 1}` : ""}) t`;
          return { data: JSON.parse(one(s)), error: null };
        }).then(res, rej);
      },
    };
    return b;
  },
};
const ids = (r) => { assert.ok(!("error" in r), r.error); return r.rows.map((x) => x.caseid); };
const quick = async (s) => ids(await runSearch(pgDb, quickSpec(s)));
const adv = async (p) => ids(await runSearch(pgDb, advancedSpec(p).spec));

live("quick search via runSearch: 90001 by number, title substring, client name; orphan by title", async () => {
  assert.deepEqual(await quick(String(CASE_ID)), [CASE_ID], "by case #");
  assert.ok((await quick("ple v. Exam")).includes(CASE_ID), "by substring of Sample v. Example");
  assert.ok((await quick("Sam Sample")).includes(CASE_ID), "by client name");
  assert.deepEqual(await quick("Orphan v"), [90002], "orphan (caseatty points at no attorney) found by title");
  const orphan = (await runSearch(pgDb, quickSpec("Orphan v"))).rows[0];
  assert.equal(orphan.attyname, "", "orphan row still hydrates (empty concat_ws name)");
});

live("user-typed % and _ match literally; or-grammar characters cannot widen the filter", async () => {
  assert.deepEqual(await quick("0% W"), [91004], "%");
  assert.deepEqual(await quick("s_C"), [91004], "_");
  assert.deepEqual(await quick('Alpha"),caseid.gt.0,casetitle.ilike.(%'), [], "quote/comma/paren injection stays one literal value");
  assert.deepEqual(await quick("a\\"), [], "trailing backslash is escaped, not a broken pattern");
});

live("advanced AND/OR/date via runSearch, incl. mixed view+tblcase sources", async () => {
  assert.deepEqual(await adv({ use_title: "1", title: "Alpha", use_client: "1", client: "Sam", mode: "and" }), [91001], "AND narrows");
  assert.deepEqual(await adv({ use_title: "1", title: "Alpha", use_client: "1", client: "Sam", mode: "or" }), [CASE_ID, 91001, 91002], "OR widens");
  assert.deepEqual(await adv({ use_startdate: "1", startdate: "2026-02-01" }), [90002, 91001], "strictly after");
  assert.deepEqual(await adv({ use_title: "1", title: "Alpha", use_status: "1", status: "closed", mode: "and" }), [91002], "mixed AND intersects");
  assert.deepEqual(await adv({ use_title: "1", title: "Orphan", use_status: "1", status: "closed", mode: "or" }), [90002, 91002], "mixed OR unions");
  assert.deepEqual(await adv({ use_title: "1", title: "Alpha", use_firm: "", mode: "and" }), [91001, 91002], "unchecked field ignored");
  assert.deepEqual(advancedSpec({ title: "  " }), { message: "No search values selected" }, "blank fields only");
});

live("lists: newest (start desc, case # desc), roster by case #, titles; orphans in every list", async () => {
  const newest = await listCases(pgDb, "newest");
  assert.deepEqual(ids(newest).slice(0, 2), [91001, 90002], "same start date -> higher case # first");
  assert.deepEqual(ids(await listCases(pgDb, "roster")), [CASE_ID, 90002, 90003, 91001, 91002, 91004, 91005]);
  const titles = ids(await listCases(pgDb, "titles"));
  for (const id of [90002, 90003]) {
    assert.ok(ids(newest).includes(id) && titles.includes(id), `case ${id} with missing rows lists`);
    assert.ok((await quick(id === 90002 ? "Orphan" : "Firmless")).includes(id), `case ${id} searchable`);
  }
});

live("median of 5 end-to-end quick searches < 1s with 5,000 cases (includes psql spawn per query)", async () => {
  seed(`insert into tblcase (caseid, caseatty, casetitle, casenotes, caseclient, tabranch, status, casestartdate, billingalert)
  select 100000 + g, 1, 'Perf ' || g || ' v. Load', 'note ' || g, 1, 'Hartford', 'Active', date '2020-01-01' + (g % 2000), false from generate_series(1, 5000) g;
analyze tblcase;`);
  assert.ok(Number(one("select count(*) from tblcase")) >= 5000);
  const ms = [];
  for (let i = 0; i < 5; i++) { const t = performance.now(); await quick("Sam Sample"); ms.push(performance.now() - t); }
  ms.sort((a, b) => a - b);
  console.log(`e2e quick search ms: ${ms.map((m) => m.toFixed(0)).join(", ")}`);
  assert.ok(ms[2] < 1000, `median ${ms[2]}ms`);
  seed();
});

function hostedEnv() {
  try {
    const env = Object.fromEntries(readFileSync(new URL("../../.env.local", import.meta.url), "utf8").split("\n").map((l) => /^([A-Z_]+)=(.*)$/.exec(l)?.slice(1)).filter(Boolean));
    return env.NEXT_PUBLIC_SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY ? env : null;
  } catch { return null; }
}
test("hosted PostgREST accepts hostile .or() values on tblcase (grammar check)", async (t) => {
  const env = hostedEnv();
  if (!env) return t.skip("no .env.local");
  const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY.replace(/^"|"$/g, ""), { auth: { persistSession: false } });
  const spec = advancedSpec({ use_subject: "1", subject: 'x"),caseid.gt.0,(\\%_', use_status: "1", status: "a,b.c", mode: "or" }).spec;
  const r = await runSearch(db, spec);
  assert.ok(!("error" in r), `PostgREST rejected the filter: ${r.error}`);
});
