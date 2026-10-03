// Live SQL semantics for lib/cases/search.ts specs against local Postgres (FOUNDATION_PG_URL).
// Each scenario runs in ONE psql call wrapped in begin/rollback, so ta_foundation keeps no rows.
// Specs are rendered to the SQL PostgREST would run: `ilike` patterns go through unchanged.
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { sql, one, resetDb, insertSql, literal } from "../foundation/harness.mjs";
import { rows, CASE_ID } from "../foundation/fixtures/rows.ts";
import { quickSpec, advancedSpec } from "../../lib/cases/search.ts";

let reachable = true;
before(() => {
  try { if (one("select count(*) from information_schema.columns where table_name = 'case_search' and column_name = 'casestatduedatedescription'") !== "1") resetDb(); } catch { reachable = false; }
});
const live = (name, fn) => test(name, (t) => (reachable ? fn() : t.skip("local Postgres unreachable")));

const TABLES = [...new Set(rows.map(([t]) => t))];
const col = (p) => `${p.source === "view" ? "v" : "c"}.${p.column}`;
const cond = (p) => (p.op === "ilike" ? `${col(p)} ilike ${literal(p.value)}` : p.op === "eq" ? `${col(p)} = ${Number(p.value)}` : `${col(p)} > ${literal(p.value)}`);
/** Spec -> SQL over case_search (left-joined to tblcase only for subject/status/start date), ordered by case #. */
const specSql = (spec) =>
  `select v.caseid from case_search v left join tblcase c on c.caseid = v.caseid where ${spec.preds.map(cond).join(spec.mode === "or" ? " or " : " and ")} order by v.caseid limit 201`;

/** Runs setup + tagged queries in one rolled-back transaction; returns { tag: [caseid, ...] }. */
function inTx(setup, queries) {
  const body = Object.entries(queries).map(([tag, q]) => `select ${literal(tag)}, s.* from (${q}) s;`).join("\n");
  const out = sql(`begin;\nset session_replication_role = replica;\ntruncate ${TABLES.join(",")} cascade;\n${setup}\nset session_replication_role = origin;\n${body}\nrollback;`);
  const res = Object.fromEntries(Object.keys(queries).map((k) => [k, []]));
  for (const [tag, id] of out) res[tag]?.push(Number(id));
  return res;
}

const kase = (caseid, casetitle, extra = {}) =>
  insertSql("tblcase", { caseid, caseatty: 1, casetitle, caseclient: 1, tabranch: "Hartford", status: "Active", casestartdate: "2026-01-01", billingalert: false, ...extra });
const SEED = [
  ...rows.map(([t, r]) => insertSql(t, r)),
  insertSql("tblclient", { clientid: 2, clientfirstname: "Jo", clientlastname: "Other" }),
  kase(90002, "Orphan v. Nobody", { caseatty: 99999, caseclient: 99999, casestartdate: "2026-03-01" }), // FK triggers off: legacy orphan
  kase(91001, "Alpha v. Beta", { casestartdate: "2026-03-01" }),
  kase(91002, "Alpha v. Gamma", { caseclient: 2, casestartdate: "2026-02-01" }),
  kase(91003, "Delta Holdings", { caseclient: 2 }),
  kase(91004, "100% Widgets_Co", { caseclient: 2 }),
  kase(91005, "1000 WidgetsXCo", { caseclient: 2 }),
].join("\n");
const adv = (p) => specSql(advancedSpec(p).spec);

live("quick search, advanced AND/OR/date, literal wildcards, orphans — against case_search", () => {
  const r = inTx(SEED, {
    byNumber: specSql(quickSpec(String(CASE_ID))),
    byTitle: specSql(quickSpec("v. Examp")),
    byClient: specSql(quickSpec("Sam Sample")),
    orphan: specSql(quickSpec("Orphan v")),
    pct: specSql(quickSpec("0% W")),
    under: specSql(quickSpec("s_C")),
    and: adv({ use_title: "1", title: "Alpha", use_client: "1", client: "Sam", mode: "and" }),
    or: adv({ use_title: "1", title: "Alpha", use_client: "1", client: "Sam", mode: "or" }),
    after: adv({ use_startdate: "1", startdate: "2026-02-01" }),
    status: adv({ use_status: "1", status: "active", use_caseid: "1", caseid: "91003" }),
    orphanAtty: adv({ use_title: "1", title: "Nobody", use_attorney: "1", attorney: "", mode: "and" }),
    newest: "select caseid from tblcase order by casestartdate desc, caseid desc",
  });
  assert.deepEqual(r.byNumber, [CASE_ID]);
  assert.deepEqual(r.byTitle, [CASE_ID]);
  assert.deepEqual(r.byClient, [CASE_ID, 91001]);
  assert.deepEqual(r.orphan, [90002]);
  assert.deepEqual(r.pct, [91004], "% typed by the user matches literally");
  assert.deepEqual(r.under, [91004], "_ typed by the user matches literally");
  assert.deepEqual(r.and, [91001]);
  assert.deepEqual(r.or, [CASE_ID, 91001, 91002]);
  assert.deepEqual(r.after, [90002, 91001], "strictly after: 2026-02-01 itself excluded");
  assert.deepEqual(r.status, [91003], "status matches case-insensitively and exactly");
  assert.deepEqual(r.orphanAtty, [90002], "blank attorney value is dropped, orphan found by title");
  assert.ok(r.newest.includes(90002), "orphan appears in lists");
  assert.deepEqual(r.newest.slice(0, 2), [91001, 90002], "newest first; same start date -> case # desc");
});

// Contract A1: each widened field is reachable — quick search on all seven, advanced on priority/point man/description.
const A1 = { casesubject: "Qsubj", status: "Qstat", casestatpriority: "Qprio", casestatpointman: "Qpman",
  casestatwaitingfor: "Qwait", casestatdescription: "Qdesc", casestatduedatedescription: "Qevnt" };
live("quick + advanced search match subject, status, priority, point man, waiting for, description, event description", () => {
  const r = inTx(`${SEED}\n${kase(91006, "Zeta", A1)}`, {
    ...Object.fromEntries(Object.entries(A1).map(([c, v]) => [c, specSql(quickSpec(v.toLowerCase().slice(1)))])),
    advPriority: adv({ priority: "qprio" }),
    advPointman: adv({ pointman: "QPMAN" }),
    advDescription: adv({ description: "desc", pointman: "pma", mode: "and" }),
    advEventNotDesc: adv({ description: "qevnt" }),
  });
  for (const c of Object.keys(A1)) assert.deepEqual(r[c], [91006], c);
  assert.deepEqual(r.advPriority, [91006]);
  assert.deepEqual(r.advPointman, [91006]);
  assert.deepEqual(r.advDescription, [91006]);
  assert.deepEqual(r.advEventNotDesc, [], "advanced Description is casestatdescription only");
});

live("median of 5 quick searches under 1s with 5,000 cases", () => {
  const q = specSql(quickSpec("Sam Sample"));
  const setup = `${rows.map(([t, r]) => insertSql(t, r)).join("\n")}
insert into tblcase (caseid, caseatty, casetitle, casenotes, caseclient, tabranch, status, casestartdate, billingalert)
  select 100000 + g, 1, 'Perf ' || g || ' v. Load', 'note ' || g, 1, 'Hartford', 'Active', date '2020-01-01' + (g % 2000), false from generate_series(1, 5000) g;
analyze tblcase;`;
  const explains = Array.from({ length: 5 }, () => `explain analyze ${q};`).join("\n");
  const out = sql(`begin;\nset session_replication_role = replica;\ntruncate ${TABLES.join(",")} cascade;\n${setup}\nset session_replication_role = origin;\nselect count(*) from tblcase;\n${explains}\nrollback;`);
  assert.equal(out[0][0], "5001");
  const ms = out.flat().map((l) => /Execution Time: ([\d.]+) ms/.exec(l)?.[1]).filter(Boolean).map(Number).sort((a, b) => a - b);
  assert.equal(ms.length, 5);
  console.log(`quick search execution ms: ${ms.join(", ")} (median ${ms[2]})`);
  assert.ok(ms[2] < 1000, `median ${ms[2]}ms`);
});

live("transactions left no rows behind", () => {
  assert.equal(one("select count(*) from tblcase where caseid >= 91001"), "0");
});
