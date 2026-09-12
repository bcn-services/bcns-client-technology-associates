// SQL-level parity: drives the REAL lib/cases/presets.ts through a fake client that translates each recorded
// PostgREST call into SQL on a PRIVATE local Postgres (FOUNDATION_PG_URL, never ta_foundation), and compares
// row-for-row, in order, with the legacy Access queries translated to Postgres. "now" is pinned.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { sql, one, resetDb, insertSql, literal, DB_URL } from "../foundation/harness.mjs";
import { workStatus, waitingFor, otherExperts, recentActivity, POINT_MEN } from "../../lib/cases/presets.ts";

process.env.PGTZ = "UTC"; // psql sessions (harness inherits env): date -> timestamptz casts in UTC, as on Supabase.
const TODAY = "2026-06-15"; // pinned; cutoff = 2026-05-11
const privateDb = !/\/ta_foundation$/.test(DB_URL);
let reachable = privateDb;
const TABLES = "tblcase, tblfundsrcvd, tblsrvauth";

const kase = (caseid, extra = {}) => insertSql("tblcase", {
  caseid, caseatty: 1, casetitle: `Case ${caseid} v. Test`, caseclient: 1, tabranch: "Hartford", status: "Active", casestartdate: "2026-01-01", billingalert: false, ...extra,
});
const ws = (caseid, casestatpriority, casestatpointman, casestatduedate) => kase(caseid, { casestatpriority, casestatpointman, casestatduedate });
const fund = (fndsid, fndscaseid, fndspmt) => insertSql("tblfundsrcvd", { fndsid, fndscaseid, fndsdate: "2026-02-01", fndspmt, fndsbranch: "Hartford" });
const sa = (srvauthid, srvauthcaseid, srvauthdate, srvdateapproved, srvauthstatus) =>
  insertSql("tblsrvauth", { srvauthid, srvauthcaseid, srvauthdate, srvauthhours: 1, srvauthstatus, srvdateapproved });

function seed() {
  sql(`set session_replication_role = replica;
truncate ${TABLES} cascade;
${ws(101, "P2", "IUO", null)}
${ws(102, "p10", null, "2026-07-01")}
${ws(103, "P1", "KJS/IUO", null)}
${ws(104, "P9", "IUO", "2026-06-01")}
${ws(105, "9", null, null)}
${ws(106, "19", "kjs", "2026-06-01")}
${ws(107, null, "IUO", "2026-06-01")}
${ws(108, "P3", "kjs", "2026-06-20")}
${ws(109, "P1", "RMD", "2026-06-20")}
${ws(110, "A5", "Oren", null)}
${ws(111, "P2", null, null)}
${kase(201, { casestatwaitingfor: "Initial Advance", casestatduedate: "2026-07-04", casestatdescription: "d1", casestatduedatedescription: "e1" })}
${kase(202, { casestatwaitingfor: "initial case material", casestartdate: "2025-12-01" })}
${kase(203, { casestatwaitingfor: "INITIAL ADVANCE AND INITIAL CASE MATERIAL" })}
${kase(204, { casestatwaitingfor: "Retainer" })}
${kase(205, { casestatwaitingfor: "Initial Advance Pending" })}
${fund(1, 201, 100.5)}
${fund(2, 201, 49.5)}
${fund(3, 203, 20)}
${fund(4, 204, 500)}
${kase(301, { otherexperts: "Dr. Smith; Dr. Jones" })}
${kase(302, { otherexperts: "SMITHSON" })}
${kase(303, { otherexperts: null })}
${kase(304, { otherexperts: "100% sure_x" })}
${kase(305, { otherexperts: "1000 surex" })}
${kase(401, { casestatlastupdated: "2026-05-12T12:00:00Z", casestatdescription: "34 days" })}
${kase(402, { casestatlastupdated: "2026-05-10T12:00:00Z", casestatdescription: "36 days" })}
${kase(403, { casestatlastupdated: "2026-05-11T00:00:00Z", casestatdescription: "exactly 35, midnight" })}
${kase(404, { casestatlastupdated: "2026-05-11T12:00:00Z", casestatdescription: "35 days, noon" })}
${kase(405, { casestatlastupdated: "2026-06-01T00:00:00Z", casestatdescription: "tie with SA dates" })}
${sa(1, 405, "2026-06-01", "2026-06-01", "Approved")}
${sa(2, 401, "2026-05-11", null, "Pending")}
${sa(3, 402, "2026-05-12", "2026-05-10", "Denied")}
set session_replication_role = origin;`);
}
before(() => {
  if (!privateDb) return;
  try { if (one("select to_regclass('tblsrvauth')") !== "tblsrvauth") resetDb(); seed(); } catch (e) { console.error(e.stderr ?? e); reachable = false; }
});
after(() => { if (reachable) sql(`truncate ${TABLES} cascade;`); });
const live = (name, fn) => test(name, (t) => (reachable ? fn() : t.skip("needs a private local FOUNDATION_PG_URL")));

/** PostgREST or= string -> [col, op, value][]; values may be "quoted" with backslash escapes. */
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
    const m = /^([a-z_]+)\.(ilike|like|eq|gt|is)\.(.*)$/s.exec(e);
    if (!m) throw new Error(`PostgREST would reject or element: ${e}`);
    let v = m[3];
    if (v.startsWith('"')) v = v.slice(1, -1).replace(/\\(.)/gs, "$1");
    return [m[1], m[2], m[2] === "is" && v === "null" ? null : v];
  });
}
const OPS = { ilike: "ilike", like: "like", eq: "=", gt: ">" };
const cond = ([c, o, v]) => (o === "is" ? `${c} is ${v === null ? "null" : literal(v)}` : `${c} ${OPS[o]} ${literal(o.endsWith("like") ? String(v).replaceAll("*", "%") : v)}`);

const pgDb = {
  from(table) {
    const q = { where: [], order: [], cols: "*", range: null };
    const b = {
      select(c) { q.cols = c; return b; },
      or(s) { q.where.push(`(${parseOr(s).map(cond).join(" or ")})`); return b; },
      not(c, o, v) { q.where.push(`not (${cond([c, o, v])})`); return b; },
      ilike(c, v) { q.where.push(cond([c, "ilike", v])); return b; },
      gt(c, v) { q.where.push(cond([c, "gt", v])); return b; },
      in(c, ids) { q.where.push(`${c} in (${ids.map(Number).join(",") || "null"})`); return b; },
      order(c, o = {}) { q.order.push(`${c} ${o.ascending === false ? "desc" : "asc"}`); return b; },
      range(f, t) { q.range = [f, t]; return b; },
      then(res, rej) {
        return Promise.resolve().then(() => {
          const s = `select replace(coalesce(jsonb_agg(t), '[]')::text, E'\\n', ' ') from (select ${q.cols} from ${table}${q.where.length ? ` where ${q.where.join(" and ")}` : ""}${q.order.length ? ` order by ${q.order.join(", ")}` : ""}${q.range ? ` offset ${q.range[0]} limit ${q.range[1] - q.range[0] + 1}` : ""}) t`;
          return { data: JSON.parse(one(s)), error: null };
        }).then(res, rej);
      },
    };
    return b;
  },
};
const rowsOf = (r) => { assert.ok(!("error" in r), r.error); return r.rows; };
const cell = (v) => (v == null ? "" : String(v));

// ---- legacy queries, translated ----
const WS_WHERE = (pm) => `casestatpriority is not null and casestatpriority not like '%9%'
  and (casestatpointman ilike '%' || ${literal(pm)} || '%' or casestatpointman is null)`;
const WS_COLS = "caseid, casestatpriority, casestatpointman, casestatduedate";
const legacyWs = (pm, sort) => sql(`select ${WS_COLS} from tblcase where ${WS_WHERE(pm)} order by ${sort === "due"
  ? "(casestatduedate is null)::int, casestatduedate, caseid" // legacy IIf(due is null,1,0); + due date, caseid tiebreak
  : `lower(casestatpriority) collate "C", caseid`}`);
const appWs = async (pm, sort) => rowsOf(await workStatus(pgDb, pm, sort)).map((r) => WS_COLS.split(", ").map((c) => cell(r[c])));
const wsIds = async (pm, sort) => rowsOf(await workStatus(pgDb, pm, sort)).map((r) => r.caseid);

live("work status: P9 excluded", async () => {
  assert.ok(!(await wsIds("", "due")).includes(104));
});
live("work status: null priority excluded", async () => {
  assert.ok(!(await wsIds("", "due")).includes(107));
});
live("work status: priority rule is the substring test ('9' and '19' excluded, 'p10' kept)", async () => {
  const got = await wsIds("", "due");
  assert.ok(!got.includes(105) && !got.includes(106), "9 / 19 excluded");
  assert.ok(got.includes(102), "p10 kept");
});
for (const pm of POINT_MEN) {
  live(`work status: null point man included under filter ${pm}`, async () => {
    const got = await wsIds(pm, "due");
    assert.ok(got.includes(102) && got.includes(111), `null point man cases missing under ${pm}: ${got}`);
  });
}
live("work status: point man is a case-insensitive contains", async () => {
  assert.deepEqual((await wsIds("KJS", "priority")).sort(), [102, 103, 108, 111]);
});
live("work status 'due' variant order: due date present first", async () => {
  assert.deepEqual(await wsIds("", "due"), [108, 109, 102, 101, 103, 110, 111]);
});
live("work status 'priority' variant order: priority text case-insensitive", async () => {
  assert.deepEqual(await wsIds("", "priority"), [110, 103, 109, 102, 101, 111, 108]);
});
for (const sort of ["due", "priority"]) {
  for (const pm of ["", ...POINT_MEN]) {
    live(`work status ${sort} / ${pm || "all"}: same rows, same order as the legacy query`, async () => {
      const want = legacyWs(pm, sort);
      assert.deepEqual(await appWs(pm, sort), want);
    });
  }
}

live("waiting for: only the three waiting-for values", async () => {
  const got = rowsOf(await waitingFor(pgDb)).map((r) => r.caseid);
  assert.deepEqual(got, [201, 202, 203]);
});
live("waiting for: funds total per case", async () => {
  const got = Object.fromEntries(rowsOf(await waitingFor(pgDb)).map((r) => [r.caseid, r.funds]));
  assert.equal(got[201], 150);
  assert.equal(got[203], 20);
});
live("waiting for: 0 for a case with no funds", async () => {
  const r = rowsOf(await waitingFor(pgDb)).find((x) => x.caseid === 202);
  assert.strictEqual(r.funds, 0);
});
live("waiting for: same rows, same order as legacy qryWaitingFor", async () => {
  const want = sql(`select c.caseid, c.casestatwaitingfor, coalesce(sum(f.fndspmt), 0), c.casestartdate, c.casestatduedate, c.casestatdescription, c.casestatduedatedescription
    from tblcase c left join tblfundsrcvd f on c.caseid = f.fndscaseid
    where lower(c.casestatwaitingfor) in ('initial advance and initial case material', 'initial advance', 'initial case material')
    group by c.caseid order by c.caseid`).map((r) => { r[2] = String(Number(r[2])); return r; });
  const got = rowsOf(await waitingFor(pgDb)).map((r) => [r.caseid, r.casestatwaitingfor, r.funds, r.casestartdate, r.casestatduedate, r.casestatdescription, r.casestatduedatedescription].map(cell));
  assert.deepEqual(got, want);
});

for (const term of ["smith", "0% s", "e_x", "SMITH"]) {
  live(`other experts "${term}": same rows as legacy OtherExpertsSearch (literal wildcards)`, async () => {
    const want = sql(`select otherexperts, caseid from tblcase where otherexperts ilike '%' || ${literal(term.replace(/[\\%_]/g, "\\$&"))} || '%' order by caseid`);
    assert.ok(want.length > 0, "seed exercises the term");
    assert.deepEqual(rowsOf(await otherExperts(pgDb, term)).map((r) => [cell(r.otherexperts), cell(r.caseid)]), want);
  });
}

const raIds = async () => rowsOf(await recentActivity(pgDb, TODAY));
live("recent activity: 34-day-old status change included", async () => {
  assert.ok((await raIds()).some((r) => r.kind === "case_activity" && r.caseid === 401));
});
live("recent activity: 36-day-old status change excluded", async () => {
  assert.ok(!(await raIds()).some((r) => r.kind === "case_activity" && r.caseid === 402));
});
live("recent activity: cutoff is strict (35-day midnight and a 35-day-old SA date excluded)", async () => {
  const got = await raIds();
  assert.ok(!got.some((r) => r.kind === "case_activity" && r.caseid === 403), "status change at exactly today-35 00:00");
  assert.ok(!got.some((r) => r.kind === "new_sa" && r.srvauthid === 2), "srvauthdate exactly today-35");
  assert.ok(got.some((r) => r.kind === "case_activity" && r.caseid === 404), "today-35 at noon is after the cutoff");
});
live("recent activity: same rows, newest first, as legacy Query_DatabaseActivity (3 case sources)", async () => {
  const want = sql(`select kind, caseid, (extract(epoch from actiondate) * 1000)::bigint, description from (
      select 'case_activity' kind, 0 rk, caseid, casestatlastupdated actiondate, null::int sid,
        concat('Case Status Update for Case#', caseid, ' (', casetitle, ') ', 'Priority  ', casestatpriority, '::', casestatdescription) description
        from tblcase where casestatlastupdated > date '${TODAY}' - 35
      union all select 'sa', 1, srvauthcaseid, srvdateapproved, srvauthid, concat('Service Authorization ', srvauthstatus, ' for Case#', srvauthcaseid)
        from tblsrvauth where srvdateapproved > date '${TODAY}' - 35
      union all select 'new_sa', 2, srvauthcaseid, srvauthdate, srvauthid, concat('New Service Authorization for Case#', srvauthcaseid)
        from tblsrvauth where srvauthdate > date '${TODAY}' - 35
    ) u order by actiondate desc, rk, caseid, sid`);
  assert.ok(want.length >= 5, "seed exercises every source");
  const got = (await raIds()).map((r) => [r.kind, String(r.caseid), String(Date.parse(r.actionDate)), r.description]);
  assert.deepEqual(got, want);
});
