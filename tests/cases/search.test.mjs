// Unit tests for lib/cases/search.ts: pure predicate building + orchestration over a fake PostgREST client.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  quickSpec, advancedSpec, orElement, escapeLike, runSearch, listCases, labelLines, NO_VALUES,
} from "../../lib/cases/search.ts";

/** Chainable fake: records ops per query; `respond(q)` returns { data, error } for the awaited query. */
function fakeDb(respond) {
  const queries = [];
  return {
    queries,
    from(table) {
      const q = { table, ops: [] };
      queries.push(q);
      const b = {};
      for (const m of ["select", "or", "filter", "order", "range", "in"]) b[m] = (...a) => { q.ops.push([m, ...a]); return b; };
      b.then = (res, rej) => Promise.resolve().then(() => respond(q)).then(res, rej);
      return b;
    },
  };
}
const op = (q, name) => q.ops.filter((o) => o[0] === name);
const rangeOf = (q) => op(q, "range")[0].slice(1);
const inIds = (q) => op(q, "in")[0]?.[2];
const hydrateRows = (q) => {
  const ids = inIds(q);
  if (q.table === "tblcase") return { data: ids.map((caseid) => ({ caseid, casetitle: `T${caseid}`, status: "Open", casestartdate: "2026-01-01" })), error: null };
  return { data: ids.map((caseid) => ({ caseid, attyname: `A${caseid}`, clientname: null, frmname: null })), error: null };
};

test("quickSpec: blank is null; digits add an exact case # match; text is a substring OR over the view", () => {
  assert.equal(quickSpec("   "), null);
  const s = quickSpec("90001");
  assert.equal(s.mode, "or");
  assert.deepEqual(s.preds[0], { source: "view", column: "caseid", op: "eq", value: "90001" });
  const t = quickSpec(" Sam Sample ");
  assert.ok(t.preds.every((p) => p.source === "view"));
  assert.ok(!t.preds.some((p) => p.column === "caseid"));
  assert.deepEqual(t.preds.find((p) => p.column === "clientname"), { source: "view", column: "clientname", op: "ilike", value: "%Sam Sample%" });
  assert.equal(t.preds.length, 10);
});

test("escapeLike makes % _ \\ literal", () => {
  assert.equal(escapeLike("50%_off\\x"), "50\\%\\_off\\\\x");
  assert.equal(quickSpec("50%_off").preds[0].value, "%50\\%\\_off%");
});

test("orElement double-quotes values so , ( ) . \" cannot extend the filter", () => {
  assert.equal(orElement({ source: "view", column: "casetitle", op: "ilike", value: '%a,b).or(x"y\\%' }),
    'casetitle.ilike."%a,b).or(x\\"y\\\\%"');
});

test("advancedSpec: empty or blank fields say No search values selected", () => {
  assert.deepEqual(advancedSpec({}), { message: NO_VALUES });
  assert.deepEqual(advancedSpec({ title: "  ", client: "" }), { message: NO_VALUES });
});

test("advancedSpec: a filled field counts with no checkbox param (hand-test: Sample + Sam returned nothing)", () => {
  const { spec } = advancedSpec({ title: "Sample", client: "Sam", mode: "or" });
  assert.equal(spec.mode, "or");
  assert.deepEqual(spec.preds.map((p) => [p.column, p.value]), [["casetitle", "%Sample%"], ["clientname", "%Sam%"]]);
});

test("advancedSpec: kinds map to exact / substring / after-date predicates", () => {
  const { spec } = advancedSpec({
    use_caseid: "1", caseid: "90001", use_title: "1", title: "Sam", use_status: "1", status: "Open_1",
    use_startdate: "1", startdate: "2026-02-01", mode: "or",
  });
  assert.equal(spec.mode, "or");
  assert.deepEqual(spec.preds, [
    { source: "view", column: "caseid", op: "eq", value: "90001" },
    { source: "view", column: "casetitle", op: "ilike", value: "%Sam%" },
    { source: "case", column: "status", op: "ilike", value: "Open\\_1" },
    { source: "case", column: "casestartdate", op: "gt", value: "2026-02-01" },
  ]);
  assert.equal(advancedSpec({ use_title: "1", title: "x" }).spec.mode, "and");
  assert.match(advancedSpec({ use_caseid: "1", caseid: "12a" }).message, /whole number/);
  assert.match(advancedSpec({ use_startdate: "1", startdate: "tomorrow" }).message, /date/);
});

test("runSearch AND across view + tblcase pages every id and intersects", async () => {
  const page1 = Array.from({ length: 1000 }, (_, i) => ({ caseid: i + 1 }));
  const db = fakeDb((q) => {
    if (op(q, "in").length) return hydrateRows(q);
    if (q.table === "case_search") return { data: rangeOf(q)[0] === 0 ? page1 : [{ caseid: 1001 }], error: null };
    return { data: [{ caseid: 2 }, { caseid: 1001 }, { caseid: 5000 }], error: null };
  });
  const { spec } = advancedSpec({ use_title: "1", title: "a", use_status: "1", status: "Open" });
  const r = await runSearch(db, spec);
  assert.deepEqual(r.rows.map((x) => x.caseid), [2, 1001]);
  assert.equal(r.more, false);
  const viewQs = db.queries.filter((q) => q.table === "case_search" && !op(q, "in").length);
  assert.equal(viewQs.length, 2, "second page fetched after a full 1000-row page");
  assert.ok(viewQs.every((q) => op(q, "or").length === 0 && op(q, "filter").length === 1));
});

test("runSearch OR across sources merges, orders by case #, and flags more", async () => {
  const db = fakeDb((q) => {
    if (op(q, "in").length) return hydrateRows(q);
    return { data: q.table === "case_search" ? [{ caseid: 1 }, { caseid: 3 }] : [{ caseid: 2 }], error: null };
  });
  const { spec } = advancedSpec({ use_title: "1", title: "a", use_status: "1", status: "Open", mode: "or" });
  const r = await runSearch(db, spec, 2);
  assert.deepEqual(r.rows.map((x) => x.caseid), [1, 2]);
  assert.equal(r.more, true);
  const orQ = db.queries.find((q) => q.table === "case_search" && op(q, "or").length);
  assert.equal(op(orQ, "or")[0][1], 'casetitle.ilike."%a%"');
});

test("hydrate keeps a case whose name row is missing (orphan) and preserves id order", async () => {
  const db = fakeDb((q) => {
    if (!op(q, "in").length) return { data: [{ caseid: 9 }, { caseid: 4 }], error: null };
    return q.table === "tblcase" ? hydrateRows(q) : { data: [], error: null };
  });
  const r = await runSearch(db, quickSpec("orphan"));
  assert.deepEqual(r.rows.map((x) => [x.caseid, x.attyname]), [[9, null], [4, null]]);
});

test("missing case_search view yields a clear error, not a throw", async () => {
  const db = fakeDb(() => ({ data: null, error: { code: "PGRST205", message: "Could not find the table 'public.case_search' in the schema cache" } }));
  const r = await runSearch(db, quickSpec("x"));
  assert.match(r.error, /case_search view is missing/);
  const l = await listCases(db, "newest");
  assert.match(l.error, /case_search view is missing|tblcase/);
});

test("listCases orders per kind and pages by 100", async () => {
  const orders = {};
  for (const kind of ["newest", "roster", "titles"]) {
    const db = fakeDb((q) => (op(q, "in").length ? hydrateRows(q) : { data: Array.from({ length: 101 }, (_, i) => ({ caseid: i + 1 })), error: null }));
    const r = await listCases(db, kind, 1);
    assert.equal(r.rows.length, 100);
    assert.equal(r.more, true);
    assert.deepEqual(rangeOf(db.queries[0]), [100, 200]);
    orders[kind] = op(db.queries[0], "order").map((o) => `${o[1]}${o[2]?.ascending === false ? " desc" : ""}`);
  }
  assert.deepEqual(orders, { newest: ["casestartdate desc", "caseid desc"], roster: ["caseid"], titles: ["casetitle", "caseid"] });
});

test("labelLines: attorney first-name-first, firm, formatted address; missing rows degrade", () => {
  const atty = { attytitle: "Atty", attyfirstname: "Pat", attymiddlename: "Q", attylastname: "Example", attysuffix: "Jr.", attyesq: true };
  const firm = { frmname: "Example & Partners LLP", frmaddress1: "1 Main St", frmaddress2: null, frmcity: "Hartford", frmstate: "CT", frmzip: "06101" };
  assert.deepEqual(labelLines(atty, firm), ["Pat Q Example, Jr., Esq.", "Example & Partners LLP", "1 Main St", "Hartford, CT 06101"]);
  assert.deepEqual(labelLines(null, null), []);
  assert.deepEqual(labelLines({ ...atty, attymiddlename: null, attysuffix: null, attyesq: false }, null), ["Pat Example"]);
});
