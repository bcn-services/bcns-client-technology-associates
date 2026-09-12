/** Unit checks for lib/contacts — fake DB clients, no network. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { SPECS, parseForm, changedColumns, createContact, updateContact, fetchAll, loadAttorneyWithFirm, ContactInputError } from "../../lib/contacts/contacts.ts";
import { PRESETS, runPreset } from "../../lib/contacts/presets.ts";
import { tables } from "./contacts-seed.mjs";

// Every legacy column (LEGACY.md) except the primary key — each must be on the form and in the payload.
const LEGACY = {
  firm: ["frmname", "frmaddress1", "frmaddress2", "frmcity", "frmstate", "frmzip", "frmphone", "frmfax", "frmemail", "frmpracticetype", "frmsize", "frmactive"],
  attorney: ["attyfirmid", "attytitle", "attyfirstname", "attymiddlename", "attylastname", "attysuffix", "attyesq", "attyphone", "attyemail", "attycellphone"],
  client: ["clienttitle", "clientfirstname", "clientlastname", "clientphone", "clientnotes"],
};
const SAMPLE = {
  firm: { frmname: "Acme LLP", frmaddress1: "1 A St", frmaddress2: "Ste 2", frmcity: "Hartford", frmstate: "CT", frmzip: "06101", frmphone: "555-1", frmfax: "555-2", frmemail: "a@example.test", frmpracticetype: "Defendent", frmsize: "Large", frmactive: "Yes" },
  attorney: { attyfirmid: "7", attytitle: "Mr.", attyfirstname: "Al", attymiddlename: "B", attylastname: "Cee", attysuffix: "Jr.", attyesq: "on", attyphone: "555-3", attyemail: "al@example.test", attycellphone: "555-4" },
  client: { clienttitle: "Ms.", clientfirstname: "Cy", clientlastname: "Dee", clientphone: "555-5", clientnotes: "notes" },
};
const fd = (o) => { const f = new FormData(); for (const [k, v] of Object.entries(o)) f.set(k, v); return f; };

for (const kind of Object.keys(LEGACY)) {
  test(`${kind}: form spec and parsed payload carry every legacy column`, () => {
    assert.deepEqual(SPECS[kind].fields.map((f) => f.col).sort(), [...LEGACY[kind]].sort());
    const p = parseForm(kind, fd(SAMPLE[kind]));
    assert.deepEqual(Object.keys(p).sort(), [...LEGACY[kind]].sort());
    for (const [k, v] of Object.entries(SAMPLE[kind])) {
      const want = k === "attyfirmid" ? 7 : k === "attyesq" ? true : v;
      assert.equal(p[k], want, k);
    }
  });
}

test("parseForm: blank → null, unchecked Esq. → false, frmactive kept as text", () => {
  const p = parseForm("attorney", fd({ attyfirmid: "1", attyfirstname: "A", attylastname: "B", attyphone: "" }));
  assert.equal(p.attyphone, null);
  assert.equal(p.attyesq, false);
  const f = parseForm("firm", fd({ ...SAMPLE.firm, frmactive: "-1" }));
  assert.equal(f.frmactive, "-1");
});

test("parseForm: required firm name / active / attorney names / firm picker are enforced", () => {
  assert.throws(() => parseForm("firm", fd({ ...SAMPLE.firm, frmname: "" })), ContactInputError);
  assert.throws(() => parseForm("firm", fd({ ...SAMPLE.firm, frmactive: " " })), ContactInputError);
  assert.throws(() => parseForm("attorney", fd({ ...SAMPLE.attorney, attyfirmid: "" })), ContactInputError);
  assert.throws(() => parseForm("attorney", fd({ ...SAMPLE.attorney, attylastname: "" })), ContactInputError);
});

function fakeDb(tablesByName = {}) {
  const calls = [];
  const db = {
    from(table) {
      const q = { table, filters: [], range: null };
      const exec = () => {
        let rows = tablesByName[table] ?? [];
        for (const [c, v] of q.filters) rows = rows.filter((r) => r[c] === v);
        if (q.range) rows = rows.slice(q.range[0], q.range[1] + 1);
        return rows;
      };
      const b = {
        select() { return b; },
        order() { return b; },
        eq(c, v) { q.filters.push([c, v]); if (q.op === "update") return Promise.resolve({ error: null }); return b; },
        range(a, z) { q.range = [a, z]; calls.push(["range", table, a, z]); return Promise.resolve({ data: exec(), error: null }); },
        maybeSingle() { return Promise.resolve({ data: exec()[0] ?? null, error: null }); },
        single() { return Promise.resolve({ data: { [SPECS.firm.id]: 11, attyid: 12, clientid: 13 }, error: null }); },
        insert(p) { calls.push(["insert", table, p]); return b; },
        update(p) { calls.push(["update", table, p]); q.op = "update"; return b; },
        delete() { throw new Error("delete called"); },
      };
      return b;
    },
  };
  return { db, calls };
}

test("createContact inserts the full parsed payload", async () => {
  const { db, calls } = fakeDb();
  const payload = parseForm("firm", fd(SAMPLE.firm));
  assert.equal(await createContact(db, "firm", payload), 11);
  assert.deepEqual(calls, [["insert", "tblfirm", payload]]);
});

test("updateContact writes only changed columns; an unchanged save writes nothing", async () => {
  const current = { clientid: 5, clienttitle: "Ms.", clientfirstname: "Cy", clientlastname: "Dee", clientphone: null, clientnotes: "" };
  const { db, calls } = fakeDb({ tblclient: [current] });
  const same = parseForm("client", fd({ clienttitle: "Ms.", clientfirstname: "Cy", clientlastname: "Dee", clientphone: "", clientnotes: "" }));
  assert.deepEqual(await updateContact(db, "client", 5, same), {});
  assert.equal(calls.filter((c) => c[0] === "update").length, 0);
  const next = { ...same, clientphone: "555-9" };
  assert.deepEqual(await updateContact(db, "client", 5, next), { clientphone: "555-9" });
  assert.deepEqual(calls.filter((c) => c[0] === "update"), [["update", "tblclient", { clientphone: "555-9" }]]);
});

test("changedColumns treats '' and null as the same blank", () => {
  assert.deepEqual(changedColumns({ a: "", b: null, c: "x" }, { a: null, b: "", c: "X" }), { c: "X" });
});

test("fetchAll pages past PostgREST's 1000-row cap", async () => {
  const big = Array.from({ length: 2500 }, (_, i) => ({ attyid: i + 1 }));
  const { db, calls } = fakeDb({ tblattorney: big });
  assert.equal((await fetchAll(db, "tblattorney", "attyid", "attyid")).length, 2500);
  assert.deepEqual(calls.map((c) => c.slice(2)), [[0, 999], [1000, 1999], [2000, 2999]]);
});

test("loadAttorneyWithFirm: Pat Example opens with firm Example & Partners LLP; missing firm → null firm", async () => {
  const t = tables();
  const { db } = fakeDb({ tblattorney: t.attys, tblfirm: t.firms });
  assert.equal((await loadAttorneyWithFirm(db, 1)).firm.frmname, "Example & Partners LLP");
  assert.equal((await loadAttorneyWithFirm(db, 8)).firm, null);
});

// --- presets against the in-memory seed set (hand-derived legacy results) --------
const ids = (rows, k) => rows.map((r) => r[k]);

test("active-firms: frmactive matched as stored text, case-insensitive — never as a boolean", () => {
  assert.deepEqual(ids(PRESETS["active-firms"].run(tables(), "yes"), "attyid"), [2, 6, 1, 7]);
  assert.deepEqual(ids(PRESETS["active-firms"].run(tables(), "No"), "attyid"), [3]);
  assert.deepEqual(ids(PRESETS["active-firms"].run(tables(), "-1"), "attyid"), [5]);
  assert.deepEqual(ids(PRESETS["active-firms"].run(tables(), "true"), "attyid"), [4]);
});
test("duplicates: by last name (case-insensitive), then firm id", () => {
  assert.deepEqual(ids(PRESETS.duplicates.run(tables()), "attyid"), [7, 3, 4, 6, 1, 5, 2]);
});
test("rename: by firm name (case-insensitive); attorney name is first + ' ' + last", () => {
  const rows = PRESETS.rename.run(tables());
  assert.deepEqual(ids(rows, "attyid"), [2, 3, 6, 1, 7, 5, 4]);
  assert.equal(rows[3].attyname, "Pat Example");
});
test("attorney-ids: attorney ⋈ case ordered by case attorney; a case with no attorney row is dropped", () => {
  assert.deepEqual(ids(PRESETS["attorney-ids"].run(tables()), "caseid"), [102, 90001, 105, 101, 100, 99, 103]);
});
test("by-state: firm state matched case-insensitively, by case #; blank state → no rows", () => {
  assert.deepEqual(ids(PRESETS["by-state"].run(tables(), "ny"), "caseid"), [99, 100, 105]);
  assert.deepEqual(ids(PRESETS["by-state"].run(tables(), "CT"), "caseid"), [101, 102, 90001]);
  assert.deepEqual(PRESETS["by-state"].run(tables(), ""), []);
});

test("runPreset reads through the injected client (paged) and never writes", async () => {
  const t = tables();
  const { db, calls } = fakeDb({ tblfirm: t.firms, tblattorney: t.attys, tblcase: t.cases });
  const rows = await runPreset(db, "by-state", "NY");
  assert.deepEqual(ids(rows, "caseid"), [99, 100, 105]);
  assert.ok(calls.every((c) => c[0] === "range"));
});

// --- guardrail: no delete path for any contact row -------------------------------
test("no delete path in app/firms, app/attorneys, app/clients, lib/contacts", () => {
  const root = new URL("../..", import.meta.url).pathname;
  const files = [];
  const walk = (d) => { for (const n of readdirSync(d)) { const p = join(d, n); statSync(p).isDirectory() ? walk(p) : files.push(p); } };
  for (const d of ["app/firms", "app/attorneys", "app/clients", "lib/contacts"]) walk(join(root, d));
  assert.ok(files.length >= 8, "expected the contact sources");
  for (const f of files) {
    const src = readFileSync(f, "utf8");
    assert.doesNotMatch(src, /\.delete\s*\(/, `${f}: .delete(`);
    assert.doesNotMatch(src, /export\s+(async\s+)?(function|const|let)\s+\w*(delete|remove|destroy)\w*/i, `${f}: delete-like export`);
    assert.doesNotMatch(src, /method\s*[:=]\s*["']DELETE["']|\bDELETE\s+FROM\b/i, `${f}: DELETE request/SQL`);
  }
});
