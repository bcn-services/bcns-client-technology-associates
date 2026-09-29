// Item 2: pricing engine (lib/bills/lines.ts + lib/bills/rates.ts). All fixtures are synthetic; every
// expected figure is worked by hand from modBillingAndServAuth.bas and written out as a literal.
// Units: hours in thousandths, rates and amounts in cents.
import { test } from "node:test";
import assert from "node:assert/strict";
import { priceBill, lineAmount, summarize, totalLine, creditsForBill, billHours, BillLineError } from "../../lib/bills/lines.ts";
import { defaultRates, personRate, addYears, testimonyFor } from "../../lib/bills/rates.ts";

const base = { billDate: "2026-03-10", caseStartDate: "2025-01-05", activity: [], factors: {}, funds: [] };
const L = (kind, linedate, description, personid, hours, rate, amount) => ({ kind, linedate, description, personid, hours, rate, amount });

// Two people: 1 at factor 1.000, 2 at 0.333. Rows and funds deliberately out of date order.
const sheet = {
  ...base,
  billType: "timesheet",
  factors: { 1: 1000, 2: 333 },
  activity: [
    { date: "2026-02-03", description: "Site inspection", hours: 2500, personid: 1 },
    { date: "2026-02-01", description: "File review", hours: 1250, personid: 2 },
    { date: "2026-02-05", description: "Report draft", hours: 3000, personid: 1 },
  ],
  funds: [
    { date: "2025-02-01", type: "Retainer", amount: 150_000 },
    { date: "2025-01-20", type: "Check", amount: 25_000 },
  ],
};

test("blank: no lines, 0 hours, 0 balance", () => {
  assert.deepEqual(priceBill({ ...base, billType: "blank", funds: sheet.funds }), { lines: [], hours: 0, balance: 0, estimated: false });
});

test("retainer: one 'Initial Advance' 4,500 line dated the bill date; prior funds not listed (VBA lists them on timesheet only)", () => {
  assert.deepEqual(priceBill({ ...base, billType: "retainer", funds: sheet.funds }), {
    lines: [L("charge", "2026-03-10", "Initial Advance", null, null, null, 450_000)],
    hours: 0, balance: 450_000, estimated: false,
  });
});

test("timesheet: credits by date, then one line per activity row by date, then one total per person", () => {
  // p1: 5.5 h × $435 = 2392.5 → 2,393. p2: $435 × 0.333 = 144.855 → $144.86; 1.25 × 144.86 = 181.075 → 181.
  // Balance: 2393 + 181 − 250 − 1500 = 824.
  assert.deepEqual(priceBill(sheet), {
    lines: [
      L("credit", "2025-01-20", "Check", null, null, null, 25_000),
      L("credit", "2025-02-01", "Retainer", null, null, null, 150_000),
      L("charge", "2026-02-01", "File review", null, 1250, null, 0),
      L("charge", "2026-02-03", "Site inspection", null, 2500, null, 0),
      L("charge", "2026-02-05", "Report draft", null, 3000, null, 0),
      L("charge", null, "5.5 hrs x $435/hr", 1, 5500, 43_500, 239_300),
      L("charge", null, "1.25 hrs x $144.86/hr", 2, 1250, 14_486, 18_100),
    ],
    hours: 6750, balance: 82_400, estimated: false,
  });
});

test("depo prep: 8 hrs (est.) x standard rate", () => {
  assert.deepEqual(priceBill({ ...base, billType: "depoprep" }), {
    lines: [
      L("estimate", null, "Review file, prepare for deposition & telecom(s)/meet with atty.", null, 8000, null, 0),
      L("estimate", null, "8 hrs (est.) x $435/hr", null, 8000, 43_500, 348_000),
    ],
    hours: 8000, balance: 348_000, estimated: true,
  });
});

test("depo: 6 hrs (est.) x testimony rate", () => {
  assert.deepEqual(priceBill({ ...base, billType: "depo" }), {
    lines: [
      L("estimate", null, "Deposition (via Zoom)", null, 6000, null, 0),
      L("estimate", null, "6 hrs (est.) x $490/hr", null, 6000, 49_000, 294_000),
    ],
    hours: 6000, balance: 294_000, estimated: true,
  });
});

test("trial: 6+2 hrs x standard, 10 hrs x testimony, $100 expenses; VBA balance 435*8 + 490*10 + 100 = 8,480", () => {
  assert.deepEqual(priceBill({ ...base, billType: "trial" }), {
    lines: [
      L("estimate", null, "Review file and prep for trial", null, 6000, null, 0),
      L("estimate", null, "Telecom w/ atty.", null, 2000, null, 0),
      L("estimate", null, "8 hrs (est.) x $435/hr", null, 8000, 43_500, 348_000),
      L("estimate", null, "Travel & court time", null, 10_000, null, 0),
      L("estimate", null, "10 hrs (est.) x $490/hr", null, 10_000, 49_000, 490_000),
      L("expense", null, "Expenses: Travel to court & parking", null, null, null, 10_000),
    ],
    hours: 18_000, balance: 848_000, estimated: true,
  });
});

test("rounding: 10.5 h × $435 → $4,568; 0.125 h × $435 → $54", () => {
  assert.equal(lineAmount(10_500, 43_500), 456_800);
  assert.equal(lineAmount(125, 43_500), 5_400);
});

test("rounding: half-dollar boundaries round up, just below rounds down", () => {
  assert.equal(lineAmount(1500, 43_500), 65_300); // 652.50 → 653
  assert.equal(lineAmount(500, 10_100), 5_100); // 50.50 → 51
  assert.equal(lineAmount(2500, 14_500), 36_300); // 362.50 → 363
  assert.equal(lineAmount(1000, 43_450), 43_500); // 434.50 → 435
  assert.equal(lineAmount(1000, 43_449), 43_400); // 434.49 → 434
});

test("person rate: standard × billingfactor rounds half-up to whole cents before any line math", () => {
  assert.equal(personRate(43_500, 333), 14_486); // 144.855 → 144.86
  assert.equal(personRate(43_500, 1000), 43_500);
  assert.equal(personRate(47_500, 501), 23_798); // 237.975 → 237.98
  const r = personRate(43_500, 333);
  assert.equal(lineAmount(1250, r), 18_100, "stored rate × hours reproduces the line");
});

test("two years: exactly 2y → $435/$490; 2y + 1 day → $475/$535", () => {
  assert.deepEqual(defaultRates("2026-03-10", "2024-03-10"), { standard: 43_500, testimony: 49_000 });
  assert.deepEqual(defaultRates("2026-03-11", "2024-03-10"), { standard: 47_500, testimony: 53_500 });
  const t = (billDate) => priceBill({ ...base, billType: "trial", billDate, caseStartDate: "2024-03-10" }).balance;
  assert.equal(t("2026-03-10"), 848_000);
  assert.equal(t("2026-03-11"), 925_000); // 475*8 + 535*10 + 100 = 9,250
});

test("two years, leap day: Feb 29 start → anniversary Feb 28 (VBA DateAdd); Feb 28 start → bill on Feb 29 is late", () => {
  assert.equal(addYears("2024-02-29", 2), "2026-02-28");
  assert.equal(addYears("2024-02-29", 4), "2028-02-29");
  assert.equal(defaultRates("2026-02-28", "2024-02-29").standard, 43_500);
  assert.equal(defaultRates("2026-03-01", "2024-02-29").standard, 47_500);
  assert.equal(defaultRates("2024-02-28", "2022-02-28").standard, 43_500);
  assert.equal(defaultRates("2024-02-29", "2022-02-28").standard, 47_500);
});

test("two years compares the BILL date, not today: an old bill on an old case keeps $435", () => {
  const p = priceBill({ ...base, billType: "depoprep", billDate: "2021-06-01", caseStartDate: "2020-01-01" });
  assert.equal(p.lines[1].rate, 43_500);
});

test("timesheet uses the 2-year standard × factor", () => {
  const p = priceBill({ ...sheet, caseStartDate: "2023-01-01" });
  assert.deepEqual(p.lines.slice(-2).map((l) => [l.rate, l.amount]), [[47_500, 261_300], [15_818, 19_800]]);
  // 5.5 × 475 = 2612.5 → 2,613; 475 × 0.333 = 158.175 → 158.18; 1.25 × 158.18 = 197.725 → 198.
});

test("testimony map: 435→490, 415→470, 400→450, 375→425, 350→400, 475→535; unknown → null", () => {
  assert.deepEqual([43_500, 41_500, 40_000, 37_500, 35_000, 47_500, 39_900].map(testimonyFor), [49_000, 47_000, 45_000, 42_500, 40_000, 53_500, null]);
});

test("override for one person changes only that person's line", () => {
  const dflt = priceBill(sheet).lines;
  const p = priceBill({ ...sheet, overrides: { 1: 39_900 } });
  assert.deepEqual(p.lines.at(-2), L("charge", null, "5.5 hrs x $399/hr", 1, 5500, 39_900, 219_500)); // 2194.5 → 2,195
  assert.deepEqual(p.lines.at(-1), dflt.at(-1));
  assert.deepEqual(p.lines.slice(0, -2), dflt.slice(0, -2));
  assert.equal(p.balance, 219_500 + 18_100 - 175_000);
});

test("override must be positive integer cents", () => {
  assert.throws(() => priceBill({ ...sheet, overrides: { 1: 0 } }), RangeError);
  assert.throws(() => priceBill({ ...sheet, overrides: { 1: 399.5 } }), RangeError);
});

test("credits beyond charges → negative balance, never clamped", () => {
  const p = priceBill({ ...base, billType: "timesheet", factors: { 1: 1000 },
    activity: [{ date: "2026-02-01", description: "Call", hours: 1000, personid: 1 }],
    funds: [{ date: "2025-06-01", type: "Retainer", amount: 500_000 }] });
  assert.equal(p.balance, 43_500 - 500_000);
});

test("summarize recomputes an admin-edited estimate (hours, amount, description) without re-pricing", () => {
  const lines = priceBill({ ...base, billType: "depo" }).lines.map((l) => ({ ...l }));
  lines[0].description = "Deposition (in person, Hartford)";
  lines[1] = { ...lines[1], hours: 4000, description: "4 hrs (est.) x $490/hr", amount: lineAmount(4000, 49_000) };
  assert.deepEqual(summarize(lines), { hours: 4000, balance: 196_000, estimated: true });
});

test("money path rejects unsafe integers and unknown bill types", () => {
  assert.throws(() => lineAmount(Number.MAX_SAFE_INTEGER, 43_500), RangeError);
  assert.throws(() => lineAmount(1.5, 43_500), RangeError);
  assert.throws(() => priceBill({ ...base, billType: "nope" }), /unknown bill type/);
});

test("person with no billingfactor row: billed as no-person time at standard rate, warned, never thrown", () => {
  // Person 9 has no tblbillingnames row; person 2's factor is also missing here. Both fold into the no-person total.
  const p = priceBill({ ...sheet, factors: { 1: 1000 }, activity: [
    ...sheet.activity,
    { date: "2026-02-02", description: "Orphan call", hours: 500, personid: 9 },
    { date: "2026-02-04", description: "No-person note", hours: 250, personid: null },
  ] });
  assert.deepEqual(p.warnings, [
    { kind: "unknown-person", personid: 2, hours: 1250 },
    { kind: "unknown-person", personid: 9, hours: 500 },
  ]);
  // 1.25 + 0.5 + 0.25 = 2 hrs at $435 → $870; person 1 unchanged at 5.5 hrs → $2,393.
  assert.deepEqual(p.lines.slice(-2), [
    L("charge", null, "5.5 hrs x $435/hr", 1, 5500, 43_500, 239_300),
    L("charge", null, "2 hrs x $435/hr", null, 2000, 43_500, 87_000),
  ]);
  assert.ok(p.lines.every((l) => l.personid !== 9 && l.personid !== 2));
  assert.equal(p.balance, 239_300 + 87_000 - 175_000);
  assert.equal("warnings" in priceBill(sheet), false, "no warnings key when every person is known");
});

test("creditsForBill: unapplied and this-bill payments count; another bill's payment is excluded", () => {
  const funds = [
    { date: "2025-01-20", type: "Retainer", amount: 150_000, fndsbillid: null },
    { date: "2025-03-01", type: "Check", amount: 300_000, fndsbillid: 11 },
    { date: "2025-04-01", type: "Check", amount: 40_000, fndsbillid: 12 },
    { date: "2025-05-01", type: "Wire", amount: 5_000 },
  ];
  assert.deepEqual(creditsForBill(funds, 12).map((f) => f.amount), [150_000, 40_000, 5_000]);
  const p = priceBill({ ...base, billType: "timesheet", factors: { 1: 1000 },
    activity: [{ date: "2026-02-01", description: "Call", hours: 1000, personid: 1 }], funds: creditsForBill(funds, 12) });
  assert.equal(p.balance, 43_500 - 195_000);
});

test("totalLine: edit an estimate 8 → 10 hrs, rebuild through totalLine, summarize agrees", () => {
  const lines = priceBill({ ...base, billType: "depoprep" }).lines.map((l) => ({ ...l }));
  assert.deepEqual(lines[1], totalLine(8000, 43_500, { kind: "estimate" }));
  lines[0].hours = 10_000;
  lines[1] = totalLine(10_000, lines[1].rate, { kind: "estimate" });
  assert.equal(lines[1].description, "10 hrs (est.) x $435/hr");
  assert.deepEqual(summarize(lines), { hours: 10_000, balance: 435_000, estimated: true });
  assert.deepEqual(totalLine(1500, 32_625, { personid: 2 }), L("charge", null, "1.5 hrs x $326.25/hr", 2, 1500, 32_625, 48_900));
});

test("summarize rejects a line amount that isn't integer cents or hours that aren't integer thousandths", () => {
  const lines = priceBill({ ...base, billType: "trial" }).lines.map((l) => ({ ...l }));
  const bad = (i, patch) => lines.map((l, j) => (j === i ? { ...l, ...patch } : l));
  const is = (i, field) => (e) => e instanceof BillLineError && e instanceof RangeError && e.lineno === i + 1 && e.field === field;
  // Two half-cent amounts sum to an integer — the per-line check still catches the first.
  assert.throws(() => summarize(bad(2, { amount: 0.5 }).map((l, j) => (j === 3 ? { ...l, amount: 0.5 } : l))), is(2, "amount"));
  assert.throws(() => summarize(bad(5, { amount: 10_000.25 })), is(5, "amount"));
  assert.throws(() => summarize(bad(0, { hours: 6000.5 })), is(0, "hours"));
  assert.throws(() => summarize(bad(4, { hours: NaN })), is(4, "hours"));
  assert.doesNotThrow(() => summarize(lines));
});

test("stable order: equal dates sort by id, whatever the input order", () => {
  const rows = [
    { date: "2026-02-01", description: "C", hours: 100, personid: 1, id: 30 },
    { date: "2026-02-01", description: "A", hours: 100, personid: 1, id: 10 },
    { date: "2026-01-31", description: "Z", hours: 100, personid: 1, id: 99 },
    { date: "2026-02-01", description: "B", hours: 100, personid: 1, id: 20 },
  ];
  const funds = [
    { date: "2025-06-01", type: "F2", amount: 1, id: 2 },
    { date: "2025-06-01", type: "F1", amount: 1, id: 1 },
  ];
  const order = (a, f) => priceBill({ ...base, billType: "timesheet", factors: { 1: 1000 }, activity: a, funds: f })
    .lines.filter((l) => l.amount === 0 || l.kind === "credit").map((l) => l.description);
  const want = ["F1", "F2", "Z", "A", "B", "C"];
  assert.deepEqual(order(rows, funds), want);
  assert.deepEqual(order([...rows].reverse(), [...funds].reverse()), want);
  assert.deepEqual(order([rows[3], rows[0], rows[2], rows[1]], funds), want);
});

test("billHours: thousandths rounded half-up to hundredths for numeric(8,2)", () => {
  assert.equal(billHours(6125), 6130);
  assert.equal(billHours(6124), 6120);
  assert.equal(billHours(6120), 6120);
  assert.equal(billHours(5), 10);
  assert.equal(billHours(4), 0);
  assert.equal(billHours(0), 0);
  assert.throws(() => billHours(6125.5), RangeError);
});
