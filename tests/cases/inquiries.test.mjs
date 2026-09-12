/** Unit checks for lib/inquiries/inquiries.ts — recording fake client, no network. */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  QUICK_SEARCH_FIELDS as MOD_QUICK_SEARCH_FIELDS, SENT_BOOLS as MOD_SENT_BOOLS, parseInquiryForm, changedColumns, createInquiry, updateInquiry,
  likePattern, orQuote, quickSearchFilter, quickSearch, advancedSearch, byAttorneyName, byHowHeard, dateFilters,
  idDateMatches, accessDate, withCurrent, todayIso, ENGINEERS, HOW_HEARD, DEFAULT_ENGINEER, DEFAULT_HOW_HEARD, CLIENT_ROLES, SUBJECT_SUGGESTIONS,
} from "../../lib/inquiries/inquiries.ts";

// Pinned independently of the module under test, so dropping a column there turns a test red.
const SENT_BOOLS = ["sentfee", "sentchecklist", "sentllb", "sentkjs", "sentiuo", "sentiuobio", "sentoren", "sentlarry", "sentcoppolino", "sentother1", "sentother2"];
// Access InquirySearchQuery, in order.
const QUICK_SEARCH_FIELDS = ["id", "inqdate", "inqcallername", "inqattyname", "inqfirm", "inqfirmlocation", "inqaccidentlocation", "inqrefferredby", "inqphonenumber", "inqemail", "inqdescription", "inqengineer", "inqsubject", "inqlocation", "inqhowheardaboutus", "inqcaption"];
const TEXT_FIELDS = QUICK_SEARCH_FIELDS.slice(2);
test("module field lists match the pinned legacy lists", () => {
  assert.deepEqual([...MOD_SENT_BOOLS], SENT_BOOLS);
  assert.deepEqual([...MOD_QUICK_SEARCH_FIELDS], QUICK_SEARCH_FIELDS);
});

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

test("quickSearchFilter: exactly the 14 legacy text columns, each ilike on the escaped, quoted pattern", () => {
  assert.equal(QUICK_SEARCH_FIELDS.length, 16);
  const parts = quickSearchFilter("a,b").split(/,(?=[a-z]+\.ilike\.)/);
  assert.deepEqual(parts, TEXT_FIELDS.map((c) => `${c}.ilike."%a,b%"`));
  assert.ok(quickSearchFilter("a", [3, 14]).endsWith(`,id.in.(3,14)`));
});

test("quickSearchFilter: fields outside the legacy query (tabranch, inqcallertitle, inqclient) are not searched", () => {
  const cols = quickSearchFilter("x", [1]).split(",").map((p) => p.split(".")[0]);
  for (const c of ["tabranch", "inqcallertitle", "inqclient"]) assert.ok(!cols.includes(c), `${c} must not be searched`);
});

test("idDateMatches: literal substring of id, ISO date, or m/d/yyyy date", () => {
  const rows = [{ id: 1234, inqdate: "2037-11-03" }, { id: 58, inqdate: "2031-05-09" }, { id: 7, inqdate: null }];
  assert.equal(accessDate("2031-05-09"), "5/9/2031");
  assert.deepEqual(idDateMatches(rows, "23"), [1234], "id substring");
  assert.deepEqual(idDateMatches(rows, "7-11-0"), [1234], "ISO substring");
  assert.deepEqual(idDateMatches(rows, "11/3/20"), [1234], "m/d/yyyy substring");
  assert.deepEqual(idDateMatches(rows, "5/9/2031"), [58]);
  assert.deepEqual(idDateMatches(rows, "05/09"), [], "Access form has no leading zeros");
  assert.deepEqual(idDateMatches(rows, "%"), [], "JS match is literal");
  assert.deepEqual(idDateMatches(rows, "7"), [1234, 7]);
});

test("quickSearch: id/date scan feeds id.in into one or() with the text filter, ordered by id", async () => {
  const { db, calls } = fakeDb({ data: [], error: null }, { range: { data: [{ id: 12, inqdate: "2031-05-09" }, { id: 40, inqdate: "2030-01-01" }], error: null } });
  await quickSearch(db, "5/9");
  assert.deepEqual(ops(calls, "or"), [[quickSearchFilter("5/9", [12])]]);
  assert.deepEqual(ops(calls, "order").at(-1), ["id"]);
  const none = fakeDb({ data: [], error: null }, { range: { data: [{ id: 12, inqdate: "2031-05-09" }], error: null } });
  await quickSearch(none.db, "smith");
  assert.deepEqual(ops(none.calls, "or"), [[quickSearchFilter("smith")]]);
});

test("value lists: engineer and how-heard exact legacy values and defaults; client role stores 'Other (see notes)'", () => {
  assert.deepEqual(ENGINEERS, ["Dr. Ojalvo", "Kris", "Lowell", "Oren", "Dr. Coppolino"]);
  assert.deepEqual(HOW_HEARD, ["Legal Pages", "Unknown", "ALM Experts", "Bar Journal, CT", "Bar Journal, FL", "Bar Journal, NY", "ExpertPages", "Forensis Group", "Google", "Internet, unspecified", "JurisPro", "Previous Case", "TA website", "Yahoo", "SEAK"]);
  assert.equal(DEFAULT_ENGINEER, "Dr. Ojalvo");
  assert.equal(DEFAULT_HOW_HEARD, "Unknown");
  assert.deepEqual(CLIENT_ROLES, ["Plaintiff", "Defendant", "Third Party", "Unknown", "Other (see notes)"]);
  assert.deepEqual(SUBJECT_SUGGESTIONS, ["Low Speed", "Golf Cart", "Motor Vehicle", "Ladder", "Products", "Slip, Trip and Fall"]);
  const r = parseInquiryForm(form({ inqengineer: "kris", inqhowheardaboutus: "google", inqclient: "other (see notes)" }));
  assert.equal(r.values.inqengineer, "Kris");
  assert.equal(r.values.inqhowheardaboutus, "Google");
  assert.equal(r.values.inqclient, "Other (see notes)");
});

test("withCurrent: an unlisted existing value is added as an extra option; a listed one (any case) is not duplicated", () => {
  assert.deepEqual(withCurrent(ENGINEERS, "Mr. Legacy"), [...ENGINEERS, "Mr. Legacy"]);
  assert.deepEqual(withCurrent(ENGINEERS, "dr. ojalvo"), ENGINEERS);
  assert.deepEqual(withCurrent(HOW_HEARD, null), HOW_HEARD);
});

test("updateInquiry: unlisted engineer/how-heard values posted back unchanged survive the save untouched", async () => {
  const posted = { inqengineer: "Mr. Legacy", inqhowheardaboutus: "Phone book", inqsubject: "new subject" };
  const values = parseInquiryForm(form(posted)).values;
  assert.equal(values.inqengineer, "Mr. Legacy");
  assert.equal(values.inqhowheardaboutus, "Phone book");
  const { db, calls } = fakeDb({ data: null, error: null }, { maybeSingle: { data: { ...values, inqsubject: "old", id: 4, inqresultingcase: null }, error: null } });
  const r = await updateInquiry(db, 4, form(posted));
  assert.ok(r.ok, r.error);
  assert.deepEqual(ops(calls, "update"), [[{ inqsubject: "new subject" }]]);
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

test("presets: attorney name ordered by date, how-heard by typed source ordered by id", async () => {
  const a = fakeDb();
  await byAttorneyName(a.db, "Pat");
  assert.deepEqual(ops(a.calls, "ilike"), [["inqattyname", "%Pat%"]]);
  assert.deepEqual(ops(a.calls, "order")[0], ["inqdate"]);
  const h = fakeDb();
  await byHowHeard(h.db, "Web");
  assert.deepEqual(ops(h.calls, "ilike"), [["inqhowheardaboutus", "%Web%"]]);
  assert.deepEqual(ops(h.calls, "order"), [["id"]]);
});

test("updateInquiry diffs against __orig: a stale tab changing one field doesn't revert another tab's edit", async () => {
  const loaded = { ...parseInquiryForm(form({ inqsubject: "Old", inqcallername: "Cy" })).values, id: 5, inqresultingcase: null };
  const live = { ...loaded, inqsubject: "Saved by tab A" };
  const { db, calls } = fakeDb({ data: null, error: null }, { maybeSingle: { data: live, error: null } });
  const r = await updateInquiry(db, 5, form({ inqsubject: "Old", inqcallername: "Dee", __orig: JSON.stringify(loaded) }));
  assert.deepEqual(r, { ok: true, changed: ["inqcallername"] });
  assert.deepEqual(ops(calls, "update"), [[{ inqcallername: "Dee" }]]);
});

test("todayIso is the Eastern date, not the server's", () => {
  assert.equal(todayIso(new Date("2026-09-12T02:30:00Z")), "2026-09-11"); // 10:30pm ET
  assert.equal(todayIso(new Date("2026-09-12T16:00:00Z")), "2026-09-12");
});
