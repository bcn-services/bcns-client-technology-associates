/** Unit checks for lib/inquiries/inquiries.ts — recording fake client, no network. */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  QUICK_SEARCH_FIELDS, SENT_BOOLS, parseInquiryForm, changedColumns, createInquiry, updateInquiry,
  likePattern, orQuote, quickSearchFilter, quickSearch, advancedSearch, byAttorneyName, byHowHeard, dateFilters,
} from "../../lib/inquiries/inquiries.ts";

/** Fake Supabase client: every builder call is recorded as [method, ...args]; awaiting resolves `result`. */
function fakeDb(result = { data: [], error: null }, byMethod = {}) {
  const calls = [];
  const builder = new Proxy({}, {
    get(_t, prop) {
      if (prop === "then") {
        const last = calls.findLast((c) => byMethod[c[0]]);
        const r = last ? byMethod[last[0]] : result;
        return (res, rej) => Promise.resolve(r).then(res, rej);
      }
      return (...args) => (calls.push([prop, ...args]), builder);
    },
  });
  return { db: { from: (t) => (calls.push(["from", t]), builder) }, calls };
}
const ops = (calls, name) => calls.filter((c) => c[0] === name).map((c) => c.slice(1));

const SENT_NAMES = ["sentother1name", "sentother2name", "sentinfo1", "sentinfo2", "sentinfo3", "sentbranch"];

function form(extra = {}) {
  const fd = new FormData();
  fd.set("inqdate", "2026-03-04");
  for (const [k, v] of Object.entries(extra)) fd.set(k, v);
  return fd;
}

test("parser: every sent checkbox present → true, absent → false; paired name fields round-trip", () => {
  const on = parseInquiryForm(form(Object.fromEntries([...SENT_BOOLS.map((k) => [k, "on"]), ...SENT_NAMES.map((k) => [k, `v-${k}`])])));
  assert.ok(on.ok);
  for (const k of SENT_BOOLS) assert.equal(on.values[k], true, `${k} checked`);
  for (const k of SENT_NAMES) assert.equal(on.values[k], `v-${k}`, `${k} text`);

  const off = parseInquiryForm(form());
  assert.ok(off.ok);
  for (const k of SENT_BOOLS) assert.equal(off.values[k], false, `${k} absent must be false`);
  for (const k of SENT_NAMES) assert.equal(off.values[k], null, `${k} blank must be null`);
});

test("parser: subject is free text — a value not in any list is kept", () => {
  const r = parseInquiryForm(form({ inqsubject: "  Slip and fall at warehouse  ", inqcallername: "Jane Doe" }));
  assert.ok(r.ok);
  assert.equal(r.values.inqsubject, "Slip and fall at warehouse");
  assert.equal(r.values.inqcallername, "Jane Doe");
});

test("parser: date required, time normalized, value lists canonicalized case-insensitively, no inqresultingcase", () => {
  assert.equal(parseInquiryForm(form({ inqdate: "" })).ok, false);
  const r = parseInquiryForm(form({ inqtime: "09:05", inqcallertitle: "paralegal", inqclient: "third party", inqattyid: "7", inqresultingcase: "42" }));
  assert.ok(r.ok);
  assert.equal(r.values.inqtime, "09:05:00");
  assert.equal(r.values.inqcallertitle, "Paralegal");
  assert.equal(r.values.inqclient, "Third Party");
  assert.equal(r.values.inqattyid, 7);
  assert.ok(!("inqresultingcase" in r.values), "resulting case must never be written");
  assert.equal(parseInquiryForm(form({ inqattyid: "x" })).ok, false);
});

test("changedColumns: only differing columns", () => {
  const { values } = parseInquiryForm(form({ inqsubject: "A", sentfee: "on", inqtime: "10:30" }));
  const row = { ...values, id: 1, inqresultingcase: 5, inqsubject: "old", sentfee: false, inqtime: "10:30:00" };
  assert.deepEqual(changedColumns(values, row), { inqsubject: "A", sentfee: true });
});

test("updateInquiry: unchecking every sent box and clearing names sends exactly those columns as false/null", async () => {
  const blank = parseInquiryForm(form()).values;
  const row = { ...blank, id: 9, inqresultingcase: null, ...Object.fromEntries(SENT_BOOLS.map((k) => [k, true])), ...Object.fromEntries(SENT_NAMES.map((k) => [k, "x"])) };
  const { db, calls } = fakeDb({ data: null, error: null }, { maybeSingle: { data: row, error: null } });
  const r = await updateInquiry(db, 9, form());
  assert.ok(r.ok, r.error);
  const [[payload]] = ops(calls, "update");
  assert.deepEqual(payload, { ...Object.fromEntries(SENT_BOOLS.map((k) => [k, false])), ...Object.fromEntries(SENT_NAMES.map((k) => [k, null])) });
  assert.deepEqual(ops(calls, "eq").at(-1), ["id", 9]);
});

test("updateInquiry: nothing changed → no update call; never a delete", async () => {
  const values = parseInquiryForm(form({ inqsubject: "Same" })).values;
  const { db, calls } = fakeDb({ data: null, error: null }, { maybeSingle: { data: { ...values, id: 3, inqresultingcase: 8 }, error: null } });
  const r = await updateInquiry(db, 3, form({ inqsubject: "Same" }));
  assert.deepEqual(r, { ok: true, changed: [] });
  assert.equal(ops(calls, "update").length, 0);
  assert.equal(ops(calls, "delete").length, 0);
});

test("createInquiry: inserts parsed values with a free-text subject and returns the new id", async () => {
  const { db, calls } = fakeDb({ data: { id: 77 }, error: null });
  const r = await createInquiry(db, form({ inqsubject: "Not a list value", inqcallername: "Jane Doe", sentkjs: "on" }));
  assert.deepEqual(r, { ok: true, id: 77 });
  const [[row]] = ops(calls, "insert");
  assert.equal(row.inqsubject, "Not a list value");
  assert.equal(row.sentkjs, true);
  assert.equal(row.sentfee, false);
});

test("likePattern: \\, % and _ are escaped so they match literally", () => {
  assert.equal(likePattern("50%_off\\x"), "%50\\%\\_off\\\\x%");
  assert.equal(likePattern("plain"), "%plain%");
});

test("orQuote: commas, parens and quotes stay inside one quoted value", () => {
  assert.equal(orQuote('a,b)"c\\'), '"a,b)\\"c\\\\"');
});

test("quickSearchFilter: exactly the 16 legacy columns, each ilike on the escaped, quoted pattern", () => {
  assert.equal(QUICK_SEARCH_FIELDS.length, 16);
  const parts = quickSearchFilter("a,b").split(/,(?=[a-z]+\.ilike\.)/);
  assert.deepEqual(parts, QUICK_SEARCH_FIELDS.map((c) => `${c}.ilike."%a,b%"`));
});

test("quickSearch: one or() with the 16-field filter, ordered by id", async () => {
  const { db, calls } = fakeDb();
  await quickSearch(db, "smith");
  assert.deepEqual(ops(calls, "or"), [[quickSearchFilter("smith")]]);
  assert.deepEqual(ops(calls, "order")[0], ["id"]);
});

test("dateFilters: between → gte+lte, onOrAfter → gte, onOrBefore → lte", () => {
  assert.deepEqual(dateFilters("between", "2026-01-01", "2026-01-31"), [["gte", "2026-01-01"], ["lte", "2026-01-31"]]);
  assert.deepEqual(dateFilters("onOrAfter", "2026-01-01"), [["gte", "2026-01-01"]]);
  assert.deepEqual(dateFilters("onOrBefore", "2026-01-31"), [["lte", "2026-01-31"]]);
  assert.deepEqual(dateFilters(undefined, "2026-01-01"), []);
});

test("advancedSearch: date modes apply gte/lte on inqdate; text fields ilike; resulting case exact", async () => {
  for (const [mode, gte, lte] of [["between", [["inqdate", "2026-01-01"]], [["inqdate", "2026-01-31"]]], ["onOrAfter", [["inqdate", "2026-01-01"]], []], ["onOrBefore", [], [["inqdate", "2026-01-01"]]]]) {
    const { db, calls } = fakeDb();
    await advancedSearch(db, { dateMode: mode, date1: "2026-01-01", date2: "2026-01-31" });
    assert.deepEqual(ops(calls, "gte"), gte, `${mode} gte`);
    assert.deepEqual(ops(calls, "lte"), lte, `${mode} lte`);
  }
  const { db, calls } = fakeDb();
  await advancedSearch(db, { attyname: "Pat", subject: "fall", location: "Ney", branch: "NJ", referredby: "Ref", resultingcase: "12" });
  assert.deepEqual(ops(calls, "ilike"), [["inqattyname", "%Pat%"], ["inqsubject", "%fall%"], ["inqlocation", "%Ney%"], ["tabranch", "%NJ%"], ["inqrefferredby", "%Ref%"]]);
  assert.deepEqual(ops(calls, "eq"), [["inqresultingcase", 12]]);
  const bad = fakeDb();
  assert.deepEqual(await advancedSearch(bad.db, { resultingcase: "abc" }), []);
});

test("presets: attorney name ordered by date, how-heard by typed source", async () => {
  const a = fakeDb();
  await byAttorneyName(a.db, "Pat");
  assert.deepEqual(ops(a.calls, "ilike"), [["inqattyname", "%Pat%"]]);
  assert.deepEqual(ops(a.calls, "order")[0], ["inqdate"]);
  const h = fakeDb();
  await byHowHeard(h.db, "Web");
  assert.deepEqual(ops(h.calls, "ilike"), [["inqhowheardaboutus", "%Web%"]]);
});
