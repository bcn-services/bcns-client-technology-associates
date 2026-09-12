// Drives the REAL insertCase / nextCaseId against a PRIVATE local Postgres (FOUNDATION_PG_URL, never ta_foundation).
// Each insert runs in its own psql process = its own connection, so the tblcase primary key — not the app — decides
// who wins a race. Invented ids 990xxx only; everything seeded here is removed in after().
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { sql, one, resetDb, literal, DB_URL } from "../foundation/harness.mjs";
import { insertCase, nextCaseId } from "../../lib/cases/create.ts";

const privateDb = !/\/ta_foundation$/.test(DB_URL);
let reachable = privateDb;
const BRANCH = "Test Branch 990", STATUS = "Test Status 990";
const CLEANUP = `delete from tblcase where caseid >= 990000; delete from tblattorney where attyid = 990001;
  delete from tblclient where clientid = 990001; delete from tblfirm where frmid = 990001;
  delete from tblbranches where branch = '${BRANCH}'; delete from tblcasestatus where casestatus = '${STATUS}';`;

before(() => {
  if (!privateDb) return;
  try {
    if (one("select to_regclass('tblcase')") !== "tblcase") resetDb();
    sql(`${CLEANUP}
      insert into tblfirm (frmid, frmname, frmactive) values (990001, 'Invented Firm 990', 'Yes');
      insert into tblattorney (attyid, attyfirmid, attyfirstname, attylastname) values (990001, 990001, 'Pat', 'Inventedlast');
      insert into tblclient (clientid, clientfirstname, clientlastname) values (990001, 'Sam', 'Inventedclient');
      insert into tblbranches (branch) values ('${BRANCH}'); insert into tblcasestatus (casestatus) values ('${STATUS}');`);
  } catch (e) { console.error(e.stderr ?? e); reachable = false; }
});
after(() => { if (reachable) sql(CLEANUP); });
const live = (name, fn) => test(name, (t) => (reachable ? fn() : t.skip("needs a private local FOUNDATION_PG_URL")));

/** Async psql on a fresh connection; errors surface as PostgREST does: { code: SQLSTATE, message }. */
function psql(...stmts) {
  return new Promise((resolve) => {
    execFile("psql", ["-X", "-q", "-At", "-v", "ON_ERROR_STOP=1", "-d", DB_URL, "-c", "\\set VERBOSITY verbose", ...stmts.flatMap((x) => ["-c", x])], (err, stdout, stderr) => {
      if (!err) return resolve({ out: stdout.trim(), error: null });
      const m = /ERROR:\s+([0-9A-Z]{5}):\s*(.*)/.exec(stderr);
      resolve({ out: "", error: { code: m?.[1] ?? "XX000", message: m?.[2] ?? stderr } });
    });
  });
}

/** The PostgREST calls create.ts makes, as SQL. The insert holds its transaction open briefly so concurrent inserts overlap. */
const pgDb = {
  from(table) {
    const q = { op: "select", cols: "*", row: null, order: null, limit: null };
    const b = {
      select(c) { q.cols = c; return b; },
      insert(r) { q.op = "insert"; q.row = r; return b; },
      order(c, o = {}) { q.order = `${c} ${o.ascending === false ? "desc" : "asc"}`; return b; },
      limit(n) { q.limit = n; return b; },
      single() { q.single = true; return b; },
      then(res, rej) {
        const run = async () => {
          if (q.op === "insert") {
            const cols = Object.keys(q.row);
            const r = await psql("begin", `insert into ${table} (${cols.join(",")}) values (${cols.map((c) => literal(q.row[c])).join(",")})`,
              "select pg_sleep(0.4)", `select json_build_object('caseid', ${Number(q.row.caseid)})`, "commit");
            return r.error ? { data: null, error: r.error } : { data: JSON.parse(r.out.split("\n").filter(Boolean).pop()), error: null };
          }
          const r = await psql(`select coalesce(json_agg(t), '[]') from (select ${q.cols} from ${table}${q.order ? ` order by ${q.order}` : ""}${q.limit ? ` limit ${q.limit}` : ""}) t`);
          return r.error ? { data: null, error: r.error } : { data: JSON.parse(r.out), error: null };
        };
        return run().then(res, rej);
      },
    };
    return b;
  },
};

const fields = (caseid, casetitle = "Invented v. Case") => ({ caseid, casetitle, casestartdate: "2026-03-07", status: STATUS, tabranch: BRANCH, caseatty: 990001, caseclient: 990001 });
const count = (id) => Number(one(`select count(*) from tblcase where caseid = ${id}`));

live("sql: insertCase creates the row with the explicit case number", async () => {
  assert.deepEqual(await insertCase(pgDb, fields(990101)), { ok: true, id: 990101 });
  assert.equal(one("select casetitle || '|' || status from tblcase where caseid = 990101"), `Invented v. Case|${STATUS}`);
});

live("sql: nextCaseId is max(caseid)+1 on real Postgres", async () => {
  await insertCase(pgDb, fields(990150));
  assert.equal(await nextCaseId(pgDb), 990151);
});

live("sql: an existing case number is refused and nothing is inserted", async () => {
  assert.equal((await insertCase(pgDb, fields(990201, "First"))).ok, true);
  const before = Number(one("select count(*) from tblcase"));
  assert.deepEqual(await insertCase(pgDb, fields(990201, "Second")), { ok: false, error: "Case number already exists" });
  assert.equal(Number(one("select count(*) from tblcase")), before);
  assert.equal(one("select casetitle from tblcase where caseid = 990201"), "First");
});

live("sql: two concurrent saves of one number → one row, one refusal", async () => {
  const results = await Promise.all([insertCase(pgDb, fields(990301, "A")), insertCase(pgDb, fields(990301, "B"))]);
  assert.equal(results.filter((r) => r.ok).length, 1, JSON.stringify(results));
  assert.deepEqual(results.find((r) => !r.ok), { ok: false, error: "Case number already exists" });
  assert.equal(count(990301), 1);
});
