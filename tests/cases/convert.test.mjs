// Unit tests for lib/inquiries/convert.ts (inquiry → case) with a fake client, plus the ConvertPanel render.
// Expected values are literals; each guard has its own assertion.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { convertInquiry, existingCaseId } from "../../lib/inquiries/convert.ts";

globalThis.React = React; // tsx compiles the .tsx with the classic JSX runtime
// Next's bundled React canary has these; stable react-dom 18.3.1 doesn't. Stub them idle.
const rd = createRequire(import.meta.url)("react-dom");
rd.useFormStatus ??= () => ({ pending: false });
rd.useFormState ??= (_action, initial) => [initial, () => {}];

const NOW = new Date(2026, 8, 11, 23, 30); // local 2026-09-11

/**
 * Fake DB: a tiny in-memory tblinquiry / tblcase / tblcasestatus behind the PostgREST builder shape.
 * `fail` names an operation ("inquiry-update") that returns an error. Every op is logged in `ops`.
 */
function fakeDb({ inquiry, cases = [], statuses = ["Active", "Open"], maxCaseId = 1234, fail = null } = {}) {
  const state = { inquiry: inquiry && { ...inquiry }, cases: [...cases], ops: [] };
  const db = {
    state,
    from(table) {
      const q = { table, op: "select", filters: [], payload: null };
      const b = {
        select(cols) { if (q.op === "select") q.cols = cols; return b; },
        insert(p) { q.op = "insert"; q.payload = p; return b; },
        update(p) { q.op = "update"; q.payload = p; return b; },
        delete() { q.op = "delete"; return b; },
        eq(c, v) { q.filters.push([c, v]); return b; },
        order() { return b; }, limit() { return b; },
        maybeSingle() { q.one = true; return b; }, single() { q.one = true; return b; },
        then(res, rej) { return Promise.resolve().then(() => run(q)).then(res, rej); },
      };
      return b;
    },
  };
  const match = (row, filters) => filters.every(([c, v]) => row[c] === v);
  function run(q) {
    state.ops.push([q.table, q.op, q.payload, q.filters]);
    if (q.table === "tblcasestatus") return { data: statuses.map((casestatus) => ({ casestatus })), error: null };
    if (q.table === "tblinquiry") {
      if (q.op === "select") return { data: state.inquiry && match(state.inquiry, q.filters) ? state.inquiry : null, error: null };
      if (q.op === "update") {
        if (fail === "inquiry-update") return { data: null, error: { code: "XX000", message: "boom" } };
        if (state.inquiry && match(state.inquiry, q.filters)) Object.assign(state.inquiry, q.payload);
        return { data: null, error: null };
      }
    }
    if (q.table === "tblcase") {
      if (q.op === "insert") { state.cases.push({ ...q.payload }); return { data: { caseid: q.payload.caseid }, error: null }; }
      if (q.op === "delete") { state.cases = state.cases.filter((c) => !match(c, q.filters)); return { data: null, error: null }; }
      if (q.op === "select" && q.filters.length) return { data: state.cases.filter((c) => match(c, q.filters)).map((c) => ({ caseid: c.caseid })), error: null };
      if (q.op === "select") { // nextCaseId: max caseid
        const ids = [maxCaseId, ...state.cases.map((c) => c.caseid)];
        return { data: [{ caseid: Math.max(...ids) }], error: null };
      }
    }
    throw new Error(`unexpected ${q.table} ${q.op}`);
  }
  return db;
}
const INQ = { id: 4242, inqsubject: "Forklift tipped in loading bay", tabranch: "Stamford", inqresultingcase: null, inqattyid: null };
const form = (o) => { const f = new FormData(); for (const [k, v] of Object.entries(o)) f.set(k, v); return f; };
const GOOD = { caseatty: "7", caseclient: "9", tabranch: "Hartford" };
const quiet = async (fn) => { const o = console.error; console.error = () => {}; try { return await fn(); } finally { console.error = o; } };
const inserts = (db) => db.state.ops.filter(([t, op]) => t === "tblcase" && op === "insert");

test("(a) inquiry update fails → the new case is deleted (no orphan) and a visible error", async () => {
  const db = fakeDb({ inquiry: INQ, fail: "inquiry-update" });
  const r = await quiet(() => convertInquiry(db, 4242, form(GOOD), NOW));
  assert.deepEqual(r, { ok: false, error: "Convert failed; no case was created." });
  assert.equal(inserts(db).length, 1);
  assert.ok(db.state.ops.some(([t, op, , f]) => t === "tblcase" && op === "delete" && f.some(([c, v]) => c === "caseid" && v === 1235)), "compensating delete of case 1235");
  assert.deepEqual(db.state.cases, []);
});

test("(b) no attorney → refused with message, no insert", async () => {
  const db = fakeDb({ inquiry: INQ });
  assert.deepEqual(await convertInquiry(db, 4242, form({ ...GOOD, caseatty: "" }), NOW), { ok: false, error: "Pick a case attorney before converting." });
  assert.equal(inserts(db).length, 0);
});
test("(b2) a non-integer attorney id is refused too", async () => {
  const db = fakeDb({ inquiry: INQ });
  assert.equal((await convertInquiry(db, 4242, form({ ...GOOD, caseatty: "1.5" }), NOW)).error, "Pick a case attorney before converting.");
  assert.equal((await convertInquiry(db, 4242, form({ ...GOOD, caseatty: "0" }), NOW)).error, "Pick a case attorney before converting.");
  assert.equal(inserts(db).length, 0);
});

test("(c) no client → refused with message, no insert", async () => {
  const db = fakeDb({ inquiry: INQ });
  const f = form(GOOD); f.delete("caseclient");
  assert.deepEqual(await convertInquiry(db, 4242, f, NOW), { ok: false, error: "Pick a case client before converting." });
  assert.equal(inserts(db).length, 0);
});

test("no branch → refused with message, no insert", async () => {
  const db = fakeDb({ inquiry: INQ });
  assert.deepEqual(await convertInquiry(db, 4242, form({ ...GOOD, tabranch: " " }), NOW), { ok: false, error: "Pick a case branch before converting." });
  assert.equal(inserts(db).length, 0);
});

test("(d) new case number 90002 (> 32767) → inqresultingcase not written", async () => {
  const db = fakeDb({ inquiry: INQ, maxCaseId: 90001 });
  assert.deepEqual(await convertInquiry(db, 4242, form(GOOD), NOW), { ok: true, id: 90002 });
  assert.equal(db.state.ops.filter(([t, op]) => t === "tblinquiry" && op === "update").length, 0);
  assert.equal(db.state.inquiry.inqresultingcase, null);
});
test("(d2) boundary: 32767 is written, 32768 is not", async () => {
  const at = fakeDb({ inquiry: INQ, maxCaseId: 32766 });
  assert.deepEqual(await convertInquiry(at, 4242, form(GOOD), NOW), { ok: true, id: 32767 });
  assert.equal(at.state.inquiry.inqresultingcase, 32767);
  const over = fakeDb({ inquiry: INQ, maxCaseId: 32767 });
  assert.deepEqual(await convertInquiry(over, 4242, form(GOOD), NOW), { ok: true, id: 32768 });
  assert.equal(over.state.inquiry.inqresultingcase, null);
});

test("(e) new case number 1235 (≤ 32767) → inqresultingcase = 1235 on that inquiry", async () => {
  const db = fakeDb({ inquiry: INQ });
  assert.deepEqual(await convertInquiry(db, 4242, form(GOOD), NOW), { ok: true, id: 1235 });
  assert.equal(db.state.inquiry.inqresultingcase, 1235);
  const up = db.state.ops.find(([t, op]) => t === "tblinquiry" && op === "update");
  assert.deepEqual(up[2], { inqresultingcase: 1235 });
  assert.deepEqual(up[3], [["id", 4242]]);
});

test("(f)(h) the inserted case: caseinquiry, title from subject, today, Open, branch, attorney, client", async () => {
  const db = fakeDb({ inquiry: INQ, statuses: ["Active", "OPEN"] });
  await convertInquiry(db, 4242, form(GOOD), NOW);
  const [row] = db.state.cases;
  assert.equal(row.caseinquiry, 4242);
  assert.equal(row.casetitle, "Forklift tipped in loading bay");
  assert.deepEqual(row, {
    caseid: 1235, casetitle: "Forklift tipped in loading bay", casestartdate: "2026-09-11", status: "OPEN",
    tabranch: "Hartford", caseatty: 7, caseclient: 9, caseinquiry: 4242,
  });
});

test("status lookup without Open → refused, no insert (never invents a lookup row)", async () => {
  const db = fakeDb({ inquiry: INQ, statuses: ["Active"] });
  assert.deepEqual(await convertInquiry(db, 4242, form(GOOD), NOW), { ok: false, error: 'The case status list has no "Open" status; add it before converting.' });
  assert.equal(inserts(db).length, 0);
  assert.ok(!db.state.ops.some(([t, op]) => t === "tblcasestatus" && op !== "select"));
});

test("(i) second convert of the same inquiry creates no second case (caseinquiry re-check)", async () => {
  const db = fakeDb({ inquiry: INQ, maxCaseId: 90001 }); // > 32767: only caseinquiry links them
  assert.equal((await convertInquiry(db, 4242, form(GOOD), NOW)).ok, true);
  assert.deepEqual(await convertInquiry(db, 4242, form(GOOD), NOW), { ok: false, error: "This inquiry already has a case." });
  assert.equal(db.state.cases.length, 1);
  assert.equal(inserts(db).length, 1);
});
test("(i2) an inquiry with inqresultingcase set (no linked case row) is refused, no insert", async () => {
  const db = fakeDb({ inquiry: { ...INQ, inqresultingcase: 555 } });
  assert.deepEqual(await convertInquiry(db, 4242, form(GOOD), NOW), { ok: false, error: "This inquiry already has a case." });
  assert.equal(inserts(db).length, 0);
});

test("unknown inquiry → Inquiry not found, no insert", async () => {
  const db = fakeDb({ inquiry: INQ });
  assert.deepEqual(await convertInquiry(db, 999, form(GOOD), NOW), { ok: false, error: "Inquiry not found." });
  assert.equal(inserts(db).length, 0);
});

test("existingCaseId: caseinquiry wins, else inqresultingcase, else null", async () => {
  const db = fakeDb({ inquiry: INQ, cases: [{ caseid: 88, caseinquiry: 4242 }] });
  assert.equal(await existingCaseId(db, { id: 4242, inqresultingcase: 5 }), 88);
  assert.equal(await existingCaseId(db, { id: 7, inqresultingcase: 5 }), 5);
  assert.equal(await existingCaseId(db, { id: 7, inqresultingcase: null }), null);
});

const PANEL = {
  inquiryId: 4242, attorneys: [{ id: 1, name: "Example, Pat" }, { id: 7, name: "Other, Al" }], clients: [{ id: 1, name: "Sample, Sam" }],
  branches: ["Hartford"], defaultAttorney: "7", defaultBranch: "Hartford", action: async () => null,
};
test("(g) panel with an existing case renders a link to it, not the convert button", async () => {
  const { ConvertPanel } = await import("../../app/inquiries/[id]/convert-panel.tsx");
  const html = renderToStaticMarkup(React.createElement(ConvertPanel, { ...PANEL, existingCase: 90002 }));
  assert.match(html, /href="\/cases\/90002"/);
  assert.doesNotMatch(html, /Convert to case/);
  assert.doesNotMatch(html, /<button/);
  assert.doesNotMatch(html, /Case attorney/);
});
test("panel without a case: labelled pickers with id values, attorney preselected, Convert to case button", async () => {
  const { ConvertPanel } = await import("../../app/inquiries/[id]/convert-panel.tsx");
  const html = renderToStaticMarkup(React.createElement(ConvertPanel, { ...PANEL, existingCase: null }));
  assert.match(html, /<label for="cv-caseatty">Case attorney<\/label>/);
  assert.match(html, /<label for="cv-caseclient">Case client<\/label>/);
  assert.match(html, /<option value="7" selected="">Other, Al<\/option>/);
  assert.match(html, /<option value="1">Sample, Sam<\/option>/);
  assert.match(html, /<button type="submit"[^>]*>Convert to case<\/button>/);
  assert.match(html, /name="inquiryId" value="4242"/);
  assert.doesNotMatch(html, /\/cases\/\d/);
});
