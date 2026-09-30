// QA gate for item 2 (pricing engine). Independent of pricing.test.mjs: every input is new and synthetic,
// every expected figure is worked by hand from modBillingAndServAuth.bas (MakeBillWordDoc, BillingDataFromTimeSheet,
// TwoYearRateUpdate, FormatEstimate) and written out as a literal. Units: hours thousandths, rates/amounts cents.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { priceBill, lineAmount, summarize } from "../../lib/bills/lines.ts";
import { defaultRates, personRate, addYears, isLate, testimonyFor } from "../../lib/bills/rates.ts";

const L = (kind, linedate, description, personid, hours, rate, amount) => ({ kind, linedate, description, personid, hours, rate, amount });
const noLate = { billDate: "2026-01-01", caseStartDate: "2025-01-01" };
const late = { billDate: "2027-05-21", caseStartDate: "2025-05-20" }; // 2y + 1d

// Timesheet fixture: 3 people (1.000, 0.750, 1.250) + one row with no person; rows and funds out of order.
const sheet = {
  ...noLate, billType: "timesheet",
  factors: { 1: 1000, 2: 750, 3: 1250 },
  activity: [
    { date: "2025-12-03", description: "Inspect vehicle", hours: 1500, personid: 2 },
    { date: "2025-11-20", description: "Review photos", hours: 2300, personid: 1 },
    { date: "2025-12-01", description: "Call with atty", hours: 200, personid: 1 },
    { date: "2025-12-05", description: "Draft memo", hours: 500, personid: null },
    { date: "2025-11-25", description: "Measure scene", hours: 4100, personid: 3 },
  ],
  funds: [
    { date: "2025-03-01", type: "Check", amount: 200_000 },
    { date: "2025-02-10", type: "Initial Advance", amount: 450_000 },
  ],
};
// p1 2.5h × $435 = 1087.5 → 1,088 · p2 1.5h × $326.25 = 489.375 → 489 · p3 4.1h × $543.75 = 2229.375 → 2,229
// no person 0.5h × $435 = 217.5 → 218. Charges 4,024; credits 6,500; balance −2,476 (not clamped).
const sheetLines = [
  L("credit", "2025-02-10", "Initial Advance", null, null, null, 450_000),
  L("credit", "2025-03-01", "Check", null, null, null, 200_000),
  L("charge", "2025-11-20", "Review photos", null, 2300, null, 0),
  L("charge", "2025-11-25", "Measure scene", null, 4100, null, 0),
  L("charge", "2025-12-01", "Call with atty", null, 200, null, 0),
  L("charge", "2025-12-03", "Inspect vehicle", null, 1500, null, 0),
  L("charge", "2025-12-05", "Draft memo", null, 500, null, 0),
  L("charge", null, "2.5 hrs x $435/hr", 1, 2500, 43_500, 108_800),
  L("charge", null, "1.5 hrs x $326.25/hr", 2, 1500, 32_625, 48_900),
  L("charge", null, "4.1 hrs x $543.75/hr", 3, 4100, 54_375, 222_900),
  L("charge", null, "0.5 hrs x $435/hr", null, 500, 43_500, 21_800),
];

test("blank: no lines, 0 hours, 0 balance even with activity and funds present", () => {
  assert.deepEqual(priceBill({ ...sheet, billType: "blank" }), { lines: [], hours: 0, balance: 0, estimated: false });
});

test("retainer: 'Initial Advance' 4,500 dated the bill date, balance 4,500", () => {
  assert.deepEqual(priceBill({ ...sheet, billType: "retainer", billDate: "2026-04-02" }), {
    lines: [L("charge", "2026-04-02", "Initial Advance", null, null, null, 450_000)], hours: 0, balance: 450_000, estimated: false,
  });
});

test("timesheet: credits first by date, rows by date, one '<h> hrs x $<rate>/hr' total per person, negative balance", () => {
  assert.deepEqual(priceBill(sheet), { lines: sheetLines, hours: 8600, balance: -247_600, estimated: false });
});

test("timesheet after 2 years uses $475 × factor; leap-day start, BILL date decides (activity dates are early)", () => {
  const one = { ...sheet, caseStartDate: "2024-02-29", factors: { 1: 1000 }, funds: [],
    activity: [{ date: "2025-01-15", description: "Scene visit", hours: 3300, personid: 1 }] };
  // 3.3 × 475 = 1567.5 → 1,568 ; 3.3 × 435 = 1435.5 → 1,436
  assert.deepEqual(priceBill({ ...one, billDate: "2026-03-01" }).lines.at(-1), L("charge", null, "3.3 hrs x $475/hr", 1, 3300, 47_500, 156_800));
  assert.deepEqual(priceBill({ ...one, billDate: "2026-02-28" }).lines.at(-1), L("charge", null, "3.3 hrs x $435/hr", 1, 3300, 43_500, 143_600));
});

test("depo prep: VBA wording, 8 hrs (est.) × firm rate, billingfactor and overrides ignored", () => {
  const x = { ...sheet, billType: "depoprep", overrides: { 1: 30_000 } };
  const want = (r, amt) => ({ lines: [
    L("estimate", null, "Review file, prepare for deposition & telecom(s)/meet with atty.", null, 8000, null, 0),
    L("estimate", null, `8 hrs (est.) x $${r}/hr`, null, 8000, r * 100, amt),
  ], hours: 8000, balance: amt, estimated: true });
  assert.deepEqual(priceBill(x), want(435, 348_000));
  assert.deepEqual(priceBill({ ...x, ...late }), want(475, 380_000));
});

test("depo: 'Deposition (via Zoom)' 6 hrs (est.) × testimony rate", () => {
  const want = (r, amt) => ({ lines: [
    L("estimate", null, "Deposition (via Zoom)", null, 6000, null, 0),
    L("estimate", null, `6 hrs (est.) x $${r}/hr`, null, 6000, r * 100, amt),
  ], hours: 6000, balance: amt, estimated: true });
  assert.deepEqual(priceBill({ ...sheet, billType: "depo" }), want(490, 294_000));
  assert.deepEqual(priceBill({ ...sheet, billType: "depo", ...late }), want(535, 321_000));
});

test("trial: 6+2 = 8 hrs × rate, 10 hrs × testimony, $100 expense; balance = VBA rate*8 + testimony*10 + 100", () => {
  const want = (r, t, bal) => ({ lines: [
    L("estimate", null, "Review file and prep for trial", null, 6000, null, 0),
    L("estimate", null, "Telecom w/ atty.", null, 2000, null, 0),
    L("estimate", null, `8 hrs (est.) x $${r}/hr`, null, 8000, r * 100, r * 800),
    L("estimate", null, "Travel & court time", null, 10_000, null, 0),
    L("estimate", null, `10 hrs (est.) x $${t}/hr`, null, 10_000, t * 100, t * 1000),
    L("expense", null, "Expenses: Travel to court & parking", null, null, null, 10_000),
  ], hours: 18_000, balance: bal, estimated: true });
  assert.deepEqual(priceBill({ ...sheet, billType: "trial" }), want(435, 490, 848_000)); // 3,480 + 4,900 + 100
  assert.deepEqual(priceBill({ ...sheet, billType: "trial", ...late }), want(475, 535, 925_000)); // 3,800 + 5,350 + 100
});

test("rounding: task cases + own half-dollar boundaries where float Int(h*r+0.5) would go wrong", () => {
  const cases = [
    [10_500, 43_500, 4568], [125, 43_500, 54], [2300, 43_500, 1001] /* 1000.5; float gives 1000.4999 */,
    [4100, 43_500, 1784] /* 1783.5; float 1783.4999 */, [1100, 43_500, 479] /* 478.5 */, [700, 43_500, 305],
    [3300, 47_500, 1568], [1300, 53_500, 696], [1, 43_500, 0], [2, 43_500, 1], [0, 43_500, 0],
  ];
  for (const [h, r, dollars] of cases) assert.equal(lineAmount(h, r), dollars * 100, `${h}/1000 h × ${r / 100}`);
});

test("billingfactor: 435 × 0.333 = 144.855 → $144.86 half-up; line = Int(hours × 144.86 + 0.5)", () => {
  assert.equal(personRate(43_500, 333), 14_486);
  assert.equal(lineAmount(25_000, 14_486), 362_200); // 3621.5 → 3,622
  assert.equal(lineAmount(24_999, 14_486), 362_100); // 3621.355 → 3,621
  const p = priceBill({ ...noLate, billType: "timesheet", factors: { 7: 333 }, funds: [],
    activity: [{ date: "2025-10-01", description: "Analysis", hours: 25_000, personid: 7 }] });
  assert.deepEqual(p.lines.at(-1), L("charge", null, "25 hrs x $144.86/hr", 7, 25_000, 14_486, 362_200));
});

test("large values: exact at the safe-integer edge, throws past it", () => {
  assert.equal(lineAmount(180_000_000_000, 50_000), 9_000_000_000_000); // 9e15 exactly
  assert.equal(lineAmount(180_000_000_001, 50_000), 9_000_000_000_100); // …0.5 dollars rounds up
  assert.throws(() => lineAmount(200_000_000_000, 50_000), RangeError);
});

test("two-year rule on the BILL date, incl. leap days and dates unrelated to today", () => {
  const std = { standard: 43_500, testimony: 49_000 }, hi = { standard: 47_500, testimony: 53_500 };
  const cases = [
    ["2026-03-11", "2024-03-10", hi], ["2026-03-10", "2024-03-10", std], ["2026-03-09", "2024-03-10", std],
    ["2026-02-28", "2024-02-29", std], ["2026-03-01", "2024-02-29", hi],
    ["2024-02-29", "2022-02-28", hi], ["2024-02-28", "2022-02-28", std], ["2028-02-29", "2026-02-28", hi],
    ["2033-01-02", "2031-01-01", hi], ["2020-06-01", "2019-01-01", std],
  ];
  for (const [bill, start, want] of cases) assert.deepEqual(defaultRates(bill, start), want, `${bill} vs ${start}`);
  assert.equal(addYears("2024-02-29", 2), "2026-02-28");
  assert.equal(isLate("2026-02-28", "2024-02-29"), false);
});

test("testimony map: 435→490, 415→470, 400→450, 375→425, 350→400; unknown → null", () => {
  for (const [s, t] of [[43_500, 49_000], [41_500, 47_000], [40_000, 45_000], [37_500, 42_500], [35_000, 40_000]]) assert.equal(testimonyFor(s), t);
  assert.equal(testimonyFor(44_000), null);
});

test("override for one person changes only that person's total line", () => {
  const p = priceBill({ ...sheet, overrides: { 3: 40_000, 99: 1 } }); // 99 not on the bill
  const want = [...sheetLines];
  want[9] = L("charge", null, "4.1 hrs x $400/hr", 3, 4100, 40_000, 164_000); // 4.1 × 400 = 1,640
  assert.deepEqual(p.lines, want);
  assert.equal(p.balance, -306_500);
  const q = priceBill({ ...sheet, overrides: { 1: 50_000 } }); // 2.5 × 500 = 1,250
  assert.deepEqual(q.lines.slice(8), sheetLines.slice(8));
  assert.deepEqual(q.lines[7], L("charge", null, "2.5 hrs x $500/hr", 1, 2500, 50_000, 125_000));
});

test("balance = charges + expenses − credits; detail rows count nothing; never clamped", () => {
  const lines = [
    L("credit", "2026-01-01", "Check", null, null, null, 900_000),
    L("charge", "2026-01-02", "Work", null, 1000, null, 0),
    L("charge", null, "1 hrs x $435/hr", 1, 1000, 43_500, 43_500),
    L("expense", null, "Parking", null, null, null, 2_500),
  ];
  assert.deepEqual(summarize(lines), { hours: 1000, balance: -854_000, estimated: false });
});

test("pure: no clock, env, or DB in lib/bills/lines.ts and rates.ts", () => {
  for (const f of ["lines.ts", "rates.ts"]) {
    const src = readFileSync(new URL(`../../lib/bills/${f}`, import.meta.url), "utf8");
    assert.doesNotMatch(src, /Date\.now|new Date\(\s*\)|process\.env|supabase|lib\/db|from ["']pg["']/, f);
  }
});
