// Unit tests for lib/bills/rules.ts. Each guard has exactly one named test; names start with "guard <letter>".
// Expectations are written-out literals, never the module's exported constants.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { isOpen, nextNotice, billFileName, lastNoticeDate, daysSinceNotice, isDue, CLOSE_AS_NOTICES, START_NOTICES } from "../../lib/bills/rules.ts";

const bill = (billnotice, billdate, billsecondnoticedate = null, billfinalnoticedate = null) =>
  ({ billnotice, billdate, billsecondnoticedate, billfinalnoticedate });

test("isOpen: true for 1st, 2nd, Final, Partial Payment", () => {
  for (const n of ["1st", "2nd", "Final", "Partial Payment"]) assert.equal(isOpen(n), true, n);
});
test("isOpen: false for Cancelled, Carried Over, Credit, Refund, Settled", () => {
  for (const n of ["Cancelled", "Carried Over", "Credit", "Refund", "Settled"]) assert.equal(isOpen(n), false, n);
});
test("guard a: isOpen('Deadbeat') is true", () => assert.equal(isOpen("Deadbeat"), true));
test("guard b: isOpen('Paid') is false", () => assert.equal(isOpen("Paid"), false));
test("guard c: isOpen('First') is false (exact legacy spelling, no prefix/case match)", () => {
  assert.equal(isOpen("First"), false);
  assert.equal(isOpen("final"), false);
});

test("nextNotice: 1st→2nd, 2nd→Final, Paid→null, unknown→null", () => {
  assert.equal(nextNotice("1st"), "2nd");
  assert.equal(nextNotice("2nd"), "Final");
  assert.equal(nextNotice("Paid"), null);
  assert.equal(nextNotice("toString"), null);
});
test("guard d: nextNotice('Final') is null", () => assert.equal(nextNotice("Final"), null));

test("close-as and start-status sets", () => {
  assert.deepEqual([...CLOSE_AS_NOTICES].sort(), ["Cancelled", "Carried Over", "Deadbeat", "Settled"]);
  assert.deepEqual([...START_NOTICES].sort(), ["1st", "Credit", "Refund"]);
});

test("guard h: billFileName keeps zero-padding and spaces in the date", () => {
  assert.equal(billFileName(2788, "Flood", "2026-08-14", 1), "Bill2788 Flood 2026 08 14-1");
  assert.equal(billFileName(12, "O'Neil", "2026-08-04", 3), "Bill12 O'Neil 2026 08 04-3");
});

test("guard e: a 1st bill dated exactly 30 days before today is due", () => {
  assert.equal(isDue(bill("1st", "2026-08-13"), "2026-09-12"), true);
});
test("a 1st bill dated 29 days before today is not due; closed bills never due", () => {
  assert.equal(isDue(bill("1st", "2026-08-14"), "2026-09-12"), false);
  assert.equal(isDue(bill("Cancelled", "2025-01-01"), "2026-09-12"), false);
});

test("guard f: a Final bill counts from billfinalnoticedate (old billdate, recent final → not due)", () => {
  const b = bill("Final", "2026-01-02", null, "2026-09-01");
  assert.equal(lastNoticeDate(b), "2026-09-01");
  assert.equal(daysSinceNotice(b, "2026-09-12"), 11);
  assert.equal(isDue(b, "2026-09-12"), false);
});
test("guard g: final notice date takes precedence over second notice date", () => {
  const b = bill("Final", "2026-05-01", "2026-06-01", "2026-08-20");
  assert.equal(lastNoticeDate(b), "2026-08-20");
  assert.equal(isDue(b, "2026-09-12"), false); // 23 days since final; 103 since second
});
test("lastNoticeDate falls back second → billdate", () => {
  assert.equal(lastNoticeDate(bill("2nd", "2026-05-01", "2026-06-01")), "2026-06-01");
  assert.equal(lastNoticeDate(bill("1st", "2026-05-01")), "2026-05-01");
});

// [billdate, today, expected daysSinceNotice, expected isDue or null (boundary: left to guard e)]
const SPANS = [
  ["2026-03-01", "2026-03-31", 30, null], // US DST start inside the span
  ["2026-10-15", "2026-11-14", 30, null], // US DST end inside the span
  ["2026-03-01", "2026-04-01", 31, true],
  ["2026-10-15", "2026-11-13", 29, false],
  ["2025-12-15", "2026-01-14", 30, null], // year boundary
];
test("guard i: daysSinceNotice/isDue identical literals under TZ=UTC, America/New_York, Pacific/Kiritimati", () => {
  const script = `import { daysSinceNotice, isDue } from "./lib/bills/rules.ts"; const s = ${JSON.stringify(SPANS)};
console.log(JSON.stringify(s.map(([d, t]) => { const b = { billnotice: "1st", billdate: d, billsecondnoticedate: null, billfinalnoticedate: null }; return [daysSinceNotice(b, t), isDue(b, t)]; })));`;
  const run = (TZ) => JSON.parse(execFileSync("node_modules/.bin/tsx", ["--eval", script], { cwd: new URL("../../", import.meta.url), env: { ...process.env, TZ }, encoding: "utf8" }).trim());
  for (const TZ of ["UTC", "America/New_York", "Pacific/Kiritimati"]) {
    const out = run(TZ);
    SPANS.forEach(([d, t, days, due], i) => {
      assert.equal(out[i][0], days, `${TZ} ${d}→${t} days`);
      if (due !== null) assert.equal(out[i][1], due, `${TZ} ${d}→${t} due`);
    });
  }
});
