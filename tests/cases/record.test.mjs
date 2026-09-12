/** Unit checks for lib/cases/record.ts — fake DB client, no network. */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  FIELDS, STAMP_COLS, BADGE, parseCaseForm, diffCase, formValue, saveCase, badges, loadCaseRecord,
  attorneyName, rolodexName, clientName, firmAddress, rolodexLines, loadCaseOptions, CaseInputError,
} from "../../lib/cases/record.ts";

/** In-memory fake of the query-builder slice record.ts uses; records every update. */
function fakeDb(tables) {
  const updates = [];
  return {
    updates,
    from(t) {
      const filters = [];
      let op = "select", payload, orderBy = null, lim = null, rng = null;
      const exec = () => {
        const hit = (tables[t] ?? []).filter((r) => filters.every((fn) => fn(r)));
        if (op === "update") { updates.push({ table: t, payload }); for (const r of hit) Object.assign(r, payload); return { data: null, error: null }; }
        let out = hit;
        if (orderBy) out = [...out].sort((a, b) => (a[orderBy.col] > b[orderBy.col] ? 1 : a[orderBy.col] < b[orderBy.col] ? -1 : 0) * (orderBy.asc ? 1 : -1));
        if (rng) out = out.slice(rng[0], rng[1] + 1);
        if (lim != null) out = out.slice(0, lim);
        return { data: out.map((r) => ({ ...r })), error: null };
      };
      const q = {
        select: () => q,
        update: (p) => ((op = "update"), (payload = p), q),
        eq: (c, v) => (filters.push((r) => r[c] === v), q),
        lt: (c, v) => (filters.push((r) => r[c] < v), q),
        gt: (c, v) => (filters.push((r) => r[c] > v), q),
        order: (col, o = {}) => ((orderBy ??= { col, asc: o.ascending !== false }), q),
        limit: (n) => ((lim = n), q),
        range: (a, b) => ((rng = [a, b]), q),
        maybeSingle: async () => ({ data: exec().data?.[0] ?? null, error: null }),
        then: (res, rej) => Promise.resolve(exec()).then(res, rej),
      };
      return q;
    },
  };
}

// A migrated-looking row: CRLF text, null bool, date and timestamp strings, ints.
const MIGRATED = {
  caseid: 1900, caseatty: 1, casetitle: "Sample v. Example", casecaption: "Line 1\r\nLine 2", casesubject: null, caseclient: 1,
  tabranch: "Hartford", status: "active", casenotes: "", casestartdate: "2026-01-10", caseenddate: null, casestatpriority: "High",
  casestatbriefdescription: null, casestatdescription: null, casestatpointman: "KJS", casestatduedate: "2026-03-01",
  casestatwaitingfor: "Retainer", casestatlastupdated: "2026-02-01T10:00:00+00:00", caseinquiry: 1, caseattyreference: null,
  casestatsubpriority: 2, casestatduedatedescription: "Trial", numunpaidbills: 3, numunapprovedsa: 0, otherexperts: null,
  numscannedfeeschedule: 0, billingalert: null, billingcc: null, casestatharddeadline: false,
};

/** The FormData an untouched, unlocked page submits for `row` (what the browser would send). */
function formFor(row, overrides = {}) {
  const f = new FormData();
  for (const fl of FIELDS) {
    if (fl.kind === "bool") { f.set(`${fl.col}__present`, "1"); if (row[fl.col] === true) f.set(fl.col, "on"); continue; }
    // Browsers submit textarea newlines as CRLF.
    const v = formValue(fl, row);
    f.set(fl.col, fl.control === "textarea" ? v.replace(/\r?\n/g, "\r\n") : v);
  }
  for (const [k, v] of Object.entries(overrides)) f.set(k, v);
  return f;
}

const NOW = new Date("2026-09-11T12:00:00Z");
const dbWith = (row = MIGRATED) => fakeDb({ tblcase: [{ ...row }] });

test("an unchanged migrated row round-trips with no update call", async () => {
  const db = dbWith();
  assert.deepEqual(await saveCase(db, 1900, formFor(MIGRATED), NOW), {});
  assert.equal(db.updates.length, 0);
});

test("changing only notes writes casenotes and does not stamp casestatlastupdated", async () => {
  const db = dbWith();
  const w = await saveCase(db, 1900, formFor(MIGRATED, { casenotes: "called back" }), NOW);
  assert.deepEqual(w, { casenotes: "called back" });
  assert.deepEqual(db.updates, [{ table: "tblcase", payload: { casenotes: "called back" } }]);
});

test("changing priority writes it plus casestatlastupdated = now", async () => {
  const db = dbWith();
  const w = await saveCase(db, 1900, formFor(MIGRATED, { casestatpriority: "Low" }), NOW);
  assert.deepEqual(w, { casestatpriority: "Low", casestatlastupdated: NOW.toISOString() });
});

test("each status-tracking column stamps; other columns do not", async () => {
  const changed = { status: "Closed", casestatpriority: "Low", casestatsubpriority: "5", casestatwaitingfor: "Material", casestatdescription: "x", casestatduedate: "2026-04-01", casestatduedatedescription: "Meeting", casestatpointman: "RC" };
  assert.deepEqual(Object.keys(changed).sort(), [...STAMP_COLS].sort());
  for (const col of FIELDS.map((f) => f.col)) {
    const db = dbWith();
    const val = changed[col] ?? { caseatty: "2", caseclient: "2", caseinquiry: "2", casestartdate: "2026-01-11", caseenddate: "2026-12-31", billingalert: null }[col] ?? "changed";
    const form = formFor(MIGRATED, val === null ? {} : { [col]: val });
    if (col === "billingalert") form.set("billingalert", "on");
    const w = await saveCase(db, 1900, form, NOW);
    assert.ok(col in w, `${col} written`);
    assert.equal("casestatlastupdated" in w, STAMP_COLS.includes(col), `${col} stamp`);
    assert.equal(Object.keys(w).length, STAMP_COLS.includes(col) ? 2 : 1, `${col} only`);
  }
});

test("numunpaidbills / numunapprovedsa are never parsed or written, even if posted", async () => {
  const db = dbWith();
  const w = await saveCase(db, 1900, formFor(MIGRATED, { numunpaidbills: "9", numunapprovedsa: "9", casenotes: "n" }), NOW);
  assert.deepEqual(Object.keys(w), ["casenotes"]);
  assert.ok(!FIELDS.some((f) => f.col === "numunpaidbills" || f.col === "numunapprovedsa"));
});

test("parseCaseForm: absent fields are left alone; blank is null; bad input is a CaseInputError", () => {
  const f = new FormData();
  f.set("casenotes", "");
  assert.deepEqual(parseCaseForm(f), { casenotes: null });
  const bad = (k, v) => { const x = new FormData(); x.set(k, v); return () => parseCaseForm(x); };
  assert.throws(bad("casetitle", "  "), CaseInputError);
  assert.throws(bad("casestatsubpriority", "two"), CaseInputError);
  assert.throws(bad("caseenddate", "2026-02-31"), CaseInputError);
  assert.throws(bad("caseatty", ""), CaseInputError);
  // Unchecked box submits only its marker.
  const b = new FormData(); b.set("billingalert__present", "1");
  assert.deepEqual(parseCaseForm(b), { billingalert: false });
});

test("diffCase normalizes: '' = null, '2' = 2, CRLF = LF, null bool = false, timestamp date = date", () => {
  assert.deepEqual(diffCase({ a: 1, casenotes: null, casestatsubpriority: 2, casecaption: "a\nb", billingalert: null, casestartdate: "2026-01-10T00:00:00" },
    { casenotes: null, casestatsubpriority: 2, casecaption: "a\nb", billingalert: false, casestartdate: "2026-01-10" }), {});
});

test("saving a missing case is a CaseInputError, not a crash", async () => {
  await assert.rejects(saveCase(fakeDb({ tblcase: [] }), 5, formFor(MIGRATED), NOW), CaseInputError);
});

test("badges: live notices/statuses, case-insensitive; fee-schedule warning only when 0 and case # > 1850", () => {
  const k = { caseid: 1851, numscannedfeeschedule: 0 };
  assert.deepEqual(badges(k, ["1st"], ["Declined"]), [BADGE.unpaid, BADGE.unapproved, BADGE.feeSchedule]);
  for (const n of ["1st", "2ND", "final", "Partial Payment", "deadbeat", "Small Claims"]) assert.ok(badges({}, [n], []).includes(BADGE.unpaid), n);
  for (const n of ["First", "Paid", null, "Estimate"]) assert.deepEqual(badges({}, [n], []), [], String(n));
  assert.deepEqual(badges({}, [], ["Approved", "APPROVED by KJS", "approved"]), []);
  assert.deepEqual(badges({}, [], ["Pending"]), [BADGE.unapproved]);
  assert.deepEqual(badges({ caseid: 1850, numscannedfeeschedule: 0 }, [], []), []);
  assert.deepEqual(badges({ caseid: 1851, numscannedfeeschedule: null }, [], []), []);
  assert.deepEqual(badges({ caseid: 1851, numscannedfeeschedule: 1 }, [], []), []);
});

const ATTY = { attyid: 1, attyfirmid: 1, attytitle: "Mr.", attyfirstname: "Pat", attymiddlename: "Q", attylastname: "Example", attysuffix: "Jr.", attyesq: true, attyemail: "pat@example.test", attyphone: "555-1", attycellphone: "555-2" };
const FIRM = { frmid: 1, frmname: "Example & Partners LLP", frmaddress1: "1 Main St", frmaddress2: null, frmcity: "Hartford", frmstate: "CT", frmzip: "06101", frmphone: "555-3", frmfax: "555-4" };

test("formatting: names and addresses; missing rows are blank", () => {
  assert.equal(attorneyName(ATTY), "Pat Q Example, Jr., Esq.");
  assert.equal(rolodexName(ATTY), "Example, Pat Q, Jr.");
  assert.equal(clientName({ clientfirstname: "Sam", clientlastname: "Sample" }), "Sam Sample");
  assert.deepEqual(firmAddress(FIRM), ["1 Main St", "Hartford, CT 06101"]);
  assert.deepEqual(rolodexLines(ATTY, FIRM), ["Example, Pat Q, Jr.", "Example & Partners LLP", "1 Main St", "Hartford, CT 06101", "Phone: 555-3", "Fax: 555-4"]);
  assert.equal(attorneyName(null), "");
  assert.equal(clientName(null), "");
  assert.deepEqual(firmAddress(null), []);
  assert.deepEqual(rolodexLines(null, null), []);
});

test("loadCaseRecord: joins, neighbours, live badges; orphan attorney/client load as null", async () => {
  const db = fakeDb({
    tblcase: [{ ...MIGRATED, caseid: 10 }, { ...MIGRATED, caseid: 20, caseatty: 99, caseclient: 99 }, { ...MIGRATED, caseid: 30 }],
    tblattorney: [ATTY], tblfirm: [FIRM], tblclient: [{ clientid: 1, clientfirstname: "Sam", clientlastname: "Sample" }],
    tblbills: [{ billcaseid: 10, billnotice: "1st" }, { billcaseid: 20, billnotice: "Paid" }],
    tblsrvauth: [{ srvauthcaseid: 10, srvauthstatus: "Declined" }],
  });
  const a = await loadCaseRecord(db, 10);
  assert.equal(a.firm.frmname, "Example & Partners LLP");
  assert.deepEqual([a.prev, a.next], [null, 20]);
  assert.deepEqual(a.badges, [BADGE.unpaid, BADGE.unapproved]);
  const b = await loadCaseRecord(db, 20);
  assert.deepEqual([b.atty, b.firm, b.client, b.prev, b.next, b.badges], [null, null, null, 10, 30, []]);
  assert.equal(await loadCaseRecord(db, 11), null);
});

test("loadCaseOptions: lookups live, inquiries newest first", async () => {
  const db = fakeDb({
    tblcasestatus: [{ casestatus: "Active" }], tblbranches: [{ branch: "Hartford" }], tblcasepriority: [{ priority: "High" }], tblcasewaitingfor: [],
    tblattorney: [ATTY], tblclient: [],
    tblinquiry: [{ id: 1, inqdate: "2026-01-05", inqsubject: "A" }, { id: 2, inqdate: "2026-03-01", inqsubject: "B" }, { id: 3, inqdate: "2026-03-01", inqsubject: "C" }],
  });
  const o = await loadCaseOptions(db);
  assert.deepEqual(o.status, ["Active"]);
  assert.deepEqual(o.inquiry.map((i) => i.value), ["3", "2", "1"]);
  assert.deepEqual(o.pointman, ["IUO", "KJS", "RMD", "JH", "Oren", "RC", "LLB"]);
});
