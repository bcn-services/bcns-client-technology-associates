// Unit: lib/cases/presets.ts against a recording fake client (no DB). SQL-level parity is presets-sql.test.mjs.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  workStatus, waitingFor, otherExperts, recentActivity, activityCutoff, firmToday, normalizePointMan, param, POINT_MEN,
} from "../../lib/cases/presets.ts";

/** Fake client: records every method call; returns `data[table]` on the first page, [] after. */
function recorder(data = {}, error = null) {
  const calls = [];
  const db = {
    from(table) {
      calls.push(["from", table]);
      let first = true;
      const b = new Proxy({}, {
        get(_, m) {
          if (m === "then") {
            return (res, rej) => Promise.resolve(error ? { data: null, error } : { data: first ? structuredClone(data[table] ?? []) : [], error: null }).then(res, rej);
          }
          return (...args) => { calls.push([m, table, ...args]); if (m === "range" && args[0] > 0) first = false; return b; };
        },
      });
      return b;
    },
  };
  return { db, calls };
}
const rowsOf = (r) => { assert.ok(!("error" in r), r.error); return r.rows; };

const WS = [
  { caseid: 3, casestatpriority: "p10", casestatduedate: null },
  { caseid: 1, casestatpriority: "P2", casestatduedate: "2026-07-01" },
  { caseid: 2, casestatpriority: "a5", casestatduedate: "2026-06-01" },
  { caseid: 4, casestatpriority: "P1", casestatduedate: null },
];

test("work status 'due' order: due date present first, then due date, then case #", async () => {
  const { db } = recorder({ tblcase: WS });
  assert.deepEqual(rowsOf(await workStatus(db, "", "due")).map((r) => r.caseid), [2, 1, 3, 4]);
});

test("work status 'priority' order: priority text case-insensitive, then case #", async () => {
  const { db } = recorder({ tblcase: WS });
  assert.deepEqual(rowsOf(await workStatus(db, "", "priority")).map((r) => r.caseid), [2, 4, 3, 1]);
});

test("work status filter calls: priority is the legacy substring test, point man contains-or-null", async () => {
  const { db, calls } = recorder({ tblcase: [] });
  await workStatus(db, "kjs", "due");
  assert.ok(calls.some((c) => c[0] === "not" && c[2] === "casestatpriority" && c[3] === "like" && c[4] === "%9%"), "not like %9%");
  assert.ok(calls.some((c) => c[0] === "not" && c[2] === "casestatpriority" && c[3] === "is" && c[4] === null), "not null");
  assert.ok(calls.some((c) => c[0] === "or" && c[2] === 'casestatpointman.ilike."%KJS%",casestatpointman.is.null'), "contains or null");
  const blank = recorder({ tblcase: [] });
  await workStatus(blank.db, "", "due");
  assert.ok(!blank.calls.some((c) => c[0] === "or"), "blank picker = all (no point-man filter)");
});

test("point man picker: only the legacy list, case-insensitive; anything else = all", () => {
  for (const p of POINT_MEN) assert.equal(normalizePointMan(` ${p.toLowerCase()} `), p);
  assert.equal(normalizePointMan("%"), "");
  assert.equal(normalizePointMan(undefined), "");
});

test("waiting for: funds summed per case in cents; 0 (not null) for a case with no funds", async () => {
  const { db } = recorder({
    tblcase: [{ caseid: 1, casestatwaitingfor: "Initial Advance" }, { caseid: 2, casestatwaitingfor: "initial case material" }],
    tblfundsrcvd: [{ fndscaseid: 1, fndspmt: 0.1 }, { fndscaseid: 1, fndspmt: "0.2" }],
  });
  const rows = rowsOf(await waitingFor(db));
  assert.equal(rows[0].funds, 0.3);
  assert.strictEqual(rows[1].funds, 0);
});

test("other experts: blank term queries nothing", async () => {
  const { db, calls } = recorder();
  assert.deepEqual(rowsOf(await otherExperts(db, "  ")), []);
  assert.equal(calls.length, 0);
});

test("recent activity: cutoff is injected today minus 35; newest first with kind tiebreak", async () => {
  assert.equal(activityCutoff("2026-06-15"), "2026-05-11");
  assert.equal(activityCutoff("2026-03-01"), "2026-01-25");
  assert.equal(firmToday(new Date("2026-06-15T03:00:00Z")), "2026-06-14", "Hartford date, not UTC");
  const { db, calls } = recorder({
    tblcase: [{ caseid: 9, casetitle: "A v. B", casestatpriority: null, casestatdescription: "x", casestatlastupdated: "2026-06-01T10:00:00+00:00" }],
    tblsrvauth: [{ srvauthid: 5, srvauthcaseid: 7, srvauthstatus: "Approved", srvauthdate: "2026-06-01", srvdateapproved: "2026-06-01" }],
  });
  const rows = rowsOf(await recentActivity(db, "2026-06-15"));
  assert.deepEqual(rows.map((r) => r.kind), ["case_activity", "sa", "new_sa"]);
  assert.equal(rows[0].description, "Case Status Update for Case#9 (A v. B) Priority  ::x");
  for (const col of ["casestatlastupdated", "srvdateapproved", "srvauthdate"]) {
    assert.ok(calls.some((c) => c[0] === "gt" && c[2] === col && c[3] === "2026-05-11"), `${col} > cutoff`);
  }
});

test("DB error: friendly message, never the raw error text", async () => {
  const { db } = recorder({}, { message: "relation secret_internal does not exist" });
  for (const r of [await workStatus(db, "", "due"), await waitingFor(db), await otherExperts(db, "x"), await recentActivity(db, "2026-06-15")]) {
    assert.ok("error" in r);
    assert.ok(!r.error.includes("secret_internal"));
  }
});

test("searchParams normalization: repeated key (array) takes the first value", () => {
  assert.equal(param(["IUO", "KJS"]), "IUO");
  assert.equal(param(undefined), "");
  assert.equal(param("RC"), "RC");
});

test("presets never write: only select-style calls, only on tblcase/tblfundsrcvd/tblsrvauth", async () => {
  const { db, calls } = recorder({ tblcase: [{ caseid: 1, casestatwaitingfor: "Initial Advance" }] });
  await workStatus(db, "IUO", "due");
  await workStatus(db, "", "priority");
  await waitingFor(db);
  await otherExperts(db, "smith");
  await recentActivity(db, "2026-06-15");
  const READ = new Set(["from", "select", "not", "or", "order", "range", "in", "ilike", "gt"]);
  for (const [m, table] of calls) {
    assert.ok(READ.has(m), `non-read method called: ${m}`);
    assert.ok(["tblcase", "tblfundsrcvd", "tblsrvauth"].includes(table), `unexpected table ${table}`);
  }
  assert.ok(calls.some((c) => c[0] === "from" && c[1] === "tblfundsrcvd"), "funds were read");
  const src = readFileSync(new URL("../../lib/cases/presets.ts", import.meta.url), "utf8");
  for (const w of [".insert(", ".update(", ".upsert(", ".delete(", ".rpc("]) assert.ok(!src.includes(w), `presets.ts contains ${w}`);
});
