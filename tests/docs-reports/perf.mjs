/**
 * Full-year detail-report perf harness. Median of 5 runs.
 *
 * Default (no env): measures the module's own overhead against an in-memory fake at the criterion's row scale
 * (50,000 tblexpenses / 10,000 tblfundsrcvd). This isolates paging + sort + cent math; it does NOT measure
 * PostgREST round trips, so it does not by itself satisfy the live-DB half of the criterion.
 *
 * Live half: NOT IMPLEMENTED, on purpose. `REPORTS_PERF_LIVE=1` seeds nothing and exits 2. The criterion's
 * 50,000/10,000 seed would land in the client's hosted Supabase project, where a failed run is known to leave
 * test rows behind, so the live half of the perf criterion is recorded UNMET rather than risking client data.
 * Wiring it up means: a throwaway database, every seeded row tagged PERF_TAG, deleted in a `finally`.
 *
 *   npx tsx tests/docs-reports/perf.mjs
 */
import { fakeDb } from "./fakedb.mjs";

const { expenseDetail, incomeDetail } = await import("../../lib/reports/detail.ts");

export const PERF_TAG = "ZZPERFSEED";
const YEAR = { start: "2025-01-01", end: "2025-12-31" };
const day = (i) => `2025-${String((i % 12) + 1).padStart(2, "0")}-${String((i % 28) + 1).padStart(2, "0")}`;
const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];

function seedTables(nExp, nFnds) {
  return {
    tblexpenses: Array.from({ length: nExp }, (_, i) => ({
      expid: i + 1, expdate: day(i), exptype: (i % 20) + 1, expinit: (i % 5) + 1,
      expdscr: `${PERF_TAG} vendor ${i % 97}`, expreason: "seed", expchecknum: i, expamount: ((i % 9999) + 1) / 100,
      expbranch: i % 2 ? "Main" : "Other", expcaseid: i % 7 === 0 ? null : (i % 500) + 1,
    })),
    tblfundsrcvd: Array.from({ length: nFnds }, (_, i) => ({
      fndsid: i + 1, fndsdate: day(i), fndscaseid: i % 7 === 0 ? null : (i % 500) + 1, fndspmt: ((i % 9999) + 1) / 100,
      fndspayee: `payee ${i % 50}`, fndsdesc: `${PERF_TAG} receipt ${i}`, fndsbranch: i % 2 ? "Main" : "Other",
    })),
    tblexptype: Array.from({ length: 20 }, (_, i) => ({ exptypeid: i + 1, exptype: `Type ${i + 1}`, active: i % 3 === 0 ? null : i % 2 === 0 })),
    tblbillingnames: Array.from({ length: 5 }, (_, i) => ({ personid: i + 1, initials: `P${i}`, billingfactor: 1 })),
    tblcase: Array.from({ length: 500 }, (_, i) => ({ caseid: i + 1, caseatty: (i % 30) + 1 })),
    tblattorney: Array.from({ length: 30 }, (_, i) => ({ attyid: i + 1, attylastname: `Last${i}`, attyfirstname: `First${i}` })),
  };
}

if (process.env.REPORTS_PERF_LIVE === "1") {
  console.error("live perf seeding is intentionally not wired to a client project; point it at a throwaway DB first");
  process.exit(2);
}

const tables = seedTables(50_000, 10_000);
const runs = [];
for (let i = 0; i < 5; i += 1) {
  const db = fakeDb(tables);
  const t0 = performance.now();
  const e = await expenseDetail(db, YEAR);
  const f = await incomeDetail(db, YEAR);
  runs.push(performance.now() - t0);
  if (i === 0) console.log(`rows: ${e.rows.length} expenses (${e.summary.length} types), ${f.rows.length} funds; total ${e.total}`);
  if (db.writes !== 0) throw new Error(`perf harness saw ${db.writes} writes`);
}
const m = median(runs);
console.log(`runs(ms): ${runs.map((r) => r.toFixed(0)).join(", ")}  median: ${m.toFixed(0)} ms  budget: 2000 ms  ${m < 2000 ? "PASS" : "FAIL"} (module overhead only, fake DB)`);
process.exit(m < 2000 ? 0 : 1);
