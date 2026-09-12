// Unit tests for lib/time/week.ts, lib/time/unbilled.ts and app/time/week-view.tsx (fake PostgREST, pattern: tests/cases/create.test.mjs).
// The fake APPLIES eq/is/gte/lte/order/range to its rows, so dropping a filter in code changes what comes back.
// Each guard has exactly one named test; names start with "guard <letter>".
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { addDays, weekBounds, listWeek, groupByDay, resolveWho, isBilled } from "../../lib/time/week.ts";
import { unbilledByCase } from "../../lib/time/unbilled.ts";
import { firmToday } from "../../lib/cases/presets.ts";

globalThis.React = React; // tsx compiles .tsx with the classic JSX runtime
createRequire(import.meta.url)("react-dom").useFormStatus ??= () => ({ pending: false });

const CASES = { 90001: "Fixture case", 90002: "All billed case", 90003: "Other case" };
const row = (actid, actdate, acthrs, actwho, { case: actcaseid = 90001, billed = false, billid = null } = {}) =>
  ({ actid, actcaseid, actdate, actdescription: `row ${actid}`, acthrs, actwho, actbilled: billed, actbillid: billid });

/** Fake Supabase client over in-memory tblactivity/tblbillingnames rows. */
function fakeDb(tables) {
  const calls = [];
  return {
    calls,
    from(table) {
      calls.push(["from", table]);
      const q = { filters: [], orders: [], range: null };
      const b = new Proxy({}, {
        get(_, k) {
          if (k === "then") {
            let rows = (tables[table] ?? []).filter((r) => q.filters.every((f) => f(r)));
            for (const [col, asc] of [...q.orders].reverse()) rows = [...rows].sort((x, y) => (x[col] < y[col] ? -1 : x[col] > y[col] ? 1 : 0) * (asc ? 1 : -1));
            if (q.range) rows = rows.slice(q.range[0], q.range[1] + 1);
            if (table === "tblactivity") rows = rows.map((r) => ({ ...r, tblcase: { caseid: r.actcaseid, casetitle: CASES[r.actcaseid] ?? "" } }));
            return (res, rej) => Promise.resolve({ data: rows, error: null }).then(res, rej);
          }
          return (...a) => {
            calls.push([k, ...a]);
            if (k === "eq") q.filters.push((r) => r[a[0]] === a[1]);
            if (k === "is") q.filters.push((r) => r[a[0]] === a[1]);
            if (k === "gte") q.filters.push((r) => r[a[0]] >= a[1]);
            if (k === "lte") q.filters.push((r) => r[a[0]] <= a[1]);
            if (k === "order") q.orders.push([a[0], a[1]?.ascending !== false]);
            if (k === "range") q.range = [a[0], a[1]];
            return b;
          };
        },
      });
      return b;
    },
  };
}

// Person 1 across two weeks; person 2 in the same week. Week of 2026-01-15 is Mon 01-12 .. Sun 01-18.
const ROWS = [
  row(10, "2026-01-11", "5.000", 1), // previous Sunday — out
  row(11, "2026-01-12", "1.250", 1),
  row(12, "2026-01-12", "0.125", 1),
  row(1, "2026-01-15", "2.000", 1), // mirrors fixture actid 1
  row(13, "2026-01-15", "0.100", 1, { billid: 77 }),
  row(14, "2026-01-18", "0.200", 1, { billed: true }), // Sunday — in
  row(15, "2026-01-19", "7.000", 1), // next Monday — out
  row(2, "2026-01-16", "1.500", 2, { billed: true }), // mirrors fixture actid 2 (JON)
  row(20, "2026-01-14", "3.000", 2),
];
const db = () => fakeDb({ tblactivity: ROWS, tblbillingnames: [{ personid: 1, initials: "KJS" }, { personid: 2, initials: "JON" }] });

test("week of 2026-01-15: only person 1's rows in Mon 01-12..Sun 01-18, grouped by day, totals equal the hand sum", async () => {
  const { monday, sunday } = weekBounds("2026-01-15");
  assert.deepEqual([monday, sunday], ["2026-01-12", "2026-01-18"]);
  const rows = await listWeek(db(), 1, monday);
  assert.deepEqual(rows.map((r) => r.actid), [11, 12, 1, 13, 14]);
  const g = groupByDay(rows);
  assert.deepEqual(g.days.map((d) => [d.date, d.total]), [["2026-01-12", "1.375"], ["2026-01-15", "2.100"], ["2026-01-18", "0.200"]]);
  // hand sum: 1.250 + 0.125 + 2.000 + 0.100 + 0.200 = 3.675
  assert.equal(g.total, "3.675");
  assert.equal(rows[0].tblcase.casetitle, "Fixture case");
});

test("guard a: listWeek filters by actwho — person 2's rows in the same week are excluded", async () => {
  const rows = await listWeek(db(), 1, "2026-01-12");
  assert.equal(rows.filter((r) => r.actwho === 2).length, 0, "another person's row leaked into the week");
});
test("guard b: listWeek lower bound — the previous Sunday 2026-01-11 is excluded", async () => {
  const rows = await listWeek(db(), 1, "2026-01-12");
  assert.equal(rows.some((r) => r.actdate === "2026-01-11"), false, "row before Monday leaked");
});
test("guard c: listWeek upper bound is Sunday-inclusive — 2026-01-18 in, 2026-01-19 out", async () => {
  const dates = (await listWeek(db(), 1, "2026-01-12")).map((r) => r.actdate);
  assert.deepEqual([dates.includes("2026-01-18"), dates.includes("2026-01-19")], [true, false]);
});
test("listWeek orders by actdate then actid", async () => {
  const d = db();
  await listWeek(d, 1, "2026-01-12");
  assert.deepEqual(d.calls.filter((c) => c[0] === "order"), [["order", "actdate", { ascending: true }], ["order", "actid", { ascending: true }]]);
});

test("?week= on a Sunday and the following Monday yield different weeks", () => {
  assert.deepEqual(weekBounds("2026-01-18"), { monday: "2026-01-12", sunday: "2026-01-18" });
  assert.deepEqual(weekBounds("2026-01-19"), { monday: "2026-01-19", sunday: "2026-01-25" });
});
test("prev/next move exactly 7 days, across month and year boundaries", () => {
  assert.equal(addDays("2026-01-12", -7), "2026-01-05");
  assert.equal(addDays("2026-01-12", 7), "2026-01-19");
  assert.equal(addDays("2026-01-26", 7), "2026-02-02");
  assert.equal(addDays("2025-12-29", 7), "2026-01-05");
  assert.equal(addDays("2026-01-05", -7), "2025-12-29");
  assert.equal(addDays("2028-02-28", 1), "2028-02-29");
  for (const a of ["2026-01-15", "2026-03-04", "2026-11-01"]) {
    const { monday } = weekBounds(a);
    assert.equal(weekBounds(addDays(monday, 7)).monday, addDays(monday, 7));
  }
});
test("page prev/next links are ±7 days from Monday and keep ?who= for admin", async () => {
  const html = await render({ role: "admin", personId: 1 }, { week: "2026-01-15", who: "2" });
  assert.match(html, /href="\/time\?week=2026-01-05&amp;who=2"[^>]*>Previous week/);
  assert.match(html, /href="\/time\?week=2026-01-19&amp;who=2"[^>]*>Next week/);
});
test("invalid ?week= falls back to this firm-local week", () => {
  assert.deepEqual(weekBounds("2026-02-30"), weekBounds());
  assert.deepEqual(weekBounds("garbage"), weekBounds());
});

// (d) TZ safety: same bounds regardless of the process TZ
const ANCHORS = ["2026-01-15", "2026-01-18", "2026-01-19", "2026-03-08", "2026-03-09", "2026-11-01", "2026-01-01", "2025-12-31"];
test("guard d: weekBounds returns identical Monday/Sunday under TZ=UTC, America/New_York, Pacific/Kiritimati", () => {
  const script = `import { weekBounds } from "./lib/time/week.ts"; console.log(JSON.stringify(${JSON.stringify(ANCHORS)}.map((a) => weekBounds(a))));`;
  const run = (TZ) => execFileSync("node_modules/.bin/tsx", ["--eval", script], { cwd: new URL("../../", import.meta.url), env: { ...process.env, TZ }, encoding: "utf8" }).trim();
  const utc = run("UTC");
  assert.equal(run("America/New_York"), utc);
  assert.equal(run("Pacific/Kiritimati"), utc);
  assert.deepEqual(JSON.parse(utc).map((w) => w.monday), ["2026-01-12", "2026-01-12", "2026-01-19", "2026-03-02", "2026-03-09", "2026-10-26", "2025-12-29", "2025-12-29"]);
});
test("weekBounds() with no arg equals the bounds of firmToday()", () => {
  assert.deepEqual(weekBounds(), weekBounds(firmToday(new Date())));
});

// (e) staff ignore ?who=
test("resolveWho: admin ?who=2 → 2; admin without ?who= → own personId", () => {
  assert.equal(resolveWho({ role: "admin", personId: 1 }, "2"), 2);
  assert.equal(resolveWho({ role: "admin", personId: 1 }, ""), 1);
});
test("guard e: staff ?who=2 still resolves to their own personId", () => {
  assert.equal(resolveWho({ role: "staff", personId: 1 }, "2"), 1);
});
test("admin ?who=2 page shows JON's fixture row; staff ?who=2 page shows only their own rows", async () => {
  const adminHtml = await render({ role: "admin", personId: 1 }, { week: "2026-01-15", who: "2" });
  assert.match(adminHtml, /Photo review|row 2</);
  assert.doesNotMatch(adminHtml, />row 11</);
  const staffHtml = await render({ role: "staff", personId: 1 }, { week: "2026-01-15", who: "2" });
  assert.match(staffHtml, />row 11</);
  assert.doesNotMatch(staffHtml, />row 2<|>row 20</);
});

// Unbilled by case
test("unbilled: case 90001 at 2.000 from fixture-mirroring rows (JON's billed 1.5 excluded)", async () => {
  const out = await unbilledByCase(fakeDb({ tblactivity: [row(1, "2026-01-15", 2, 1), row(2, "2026-01-16", 1.5, 2, { billed: true })] }));
  assert.deepEqual(out, [{ caseid: 90001, casetitle: "Fixture case", hours: "2.000" }]);
});
const UNB = [
  row(1, "2026-01-15", "2.000", 1),
  row(30, "2026-01-15", "4.000", 1, { case: 90002, billed: true }),
  row(31, "2026-01-15", "4.000", 1, { case: 90002, billed: true, billid: 5 }),
];
test("guard g: a row with actbilled=true and actbillid null is excluded", async () => {
  const out = await unbilledByCase(fakeDb({ tblactivity: [...UNB, row(40, "2026-01-15", "0.500", 1, { billed: true })] }));
  assert.equal(out.find((c) => c.caseid === 90001).hours, "2.000", "actbilled=true row counted as unbilled");
});
test("guard h: a row with actbilled=false but actbillid set is excluded", async () => {
  const out = await unbilledByCase(fakeDb({ tblactivity: [...UNB, row(41, "2026-01-15", "0.750", 1, { billid: 9 })] }));
  assert.equal(out.find((c) => c.caseid === 90001).hours, "2.000", "actbillid-set row counted as unbilled");
});
test("guard i: a case whose rows are all billed is omitted; a case netting to 0 is omitted", async () => {
  const out = await unbilledByCase(fakeDb({ tblactivity: [...UNB, row(50, "2026-01-15", "0.000", 1, { case: 90003 })] }));
  assert.deepEqual(out.map((c) => c.caseid), [90001]);
});
test("unbilled: ordered by case #, sums without float drift, pages past 1000 rows", async () => {
  const many = Array.from({ length: 1001 }, (_, i) => row(1000 + i, "2026-01-15", "0.001", 1, { case: 90003 }));
  const out = await unbilledByCase(fakeDb({ tblactivity: [row(2, "2026-01-15", "0.1", 1, { case: 90003 }), row(3, "2026-01-15", "0.2", 1, { case: 90001 }), ...many] }));
  assert.deepEqual(out, [{ caseid: 90001, casetitle: "Fixture case", hours: "0.200" }, { caseid: 90003, casetitle: "Other case", hours: "1.101" }]);
});

// (j) billed marker
test("billed marker: actbilled-only row is billed; unbilled row is not", () => {
  assert.equal(isBilled({ actbilled: true, actbillid: null }), true);
  assert.equal(isBilled({ actbilled: false, actbillid: null }), false);
});
test("guard j: billed marker is true for an actbillid-only row", () => {
  assert.equal(isBilled({ actbilled: false, actbillid: 77 }), true);
});

// Rendering (WeekSection with an injected fake db)
async function render(session, { week, who } = {}) {
  const { WeekSection } = await import("../../app/time/week-view.tsx");
  const el = await WeekSection({ session: { userId: "u", email: "e", ...session }, week, who, db: db() });
  return renderToStaticMarkup(el);
}
const labelsAndAria = (html) => [
  ...[...html.matchAll(/<label[^>]*>([\s\S]*?)<\/label>/g)].map((m) => m[1]),
  ...[...html.matchAll(/aria-label="([^"]*)"/g)].map((m) => m[1]),
];
for (const role of ["admin", "staff"]) {
  test(`journey 03 trap (${role}): week view adds no case/hours/description label, no save/add-entry button, no entry-saved text`, async () => {
    const html = await render({ role, personId: 1 }, { week: "2026-01-15" });
    assert.deepEqual(labelsAndAria(html).filter((t) => /case|hours|description/i.test(t)), []);
    const buttons = [...html.matchAll(/<button[^>]*>([\s\S]*?)<\/button>/g)].map((m) => m[1]);
    assert.deepEqual(buttons.filter((t) => /save|add entry/i.test(t)), []);
    assert.doesNotMatch(html, /entry (added|saved)/i);
  });
}
// Timer (app/time/timer.tsx) sits on the same /time page: every state's markup must stay clear of journey 03's selectors.
const T = Date.UTC(2026, 0, 15, 14, 0);
const timerStates = {
  "initial (server render)": async () => { const { Timer } = await import("../../app/time/timer.tsx"); return React.createElement(Timer, { now: () => T }); },
  "running + refusal": async () => { const { TimerView } = await import("../../app/time/timer.tsx"); return React.createElement(TimerView, { timer: { caseId: "90001", startedAt: T - 40 * 60_000, description: "note" }, now: T, message: "Stop the running timer first" }); },
  "stopped + empty-case refusal": async () => { const { TimerView } = await import("../../app/time/timer.tsx"); return React.createElement(TimerView, { timer: { caseId: "90001", startedAt: T - 40 * 60_000, description: "note", stoppedAt: T }, now: T, message: "Enter a case number first" }); },
};
for (const [name, el] of Object.entries(timerStates)) {
  test(`journey 03 trap (timer ${name}): no case/hours/description label, no save/add-entry button, no entry-saved text`, async () => {
    const html = renderToStaticMarkup(await el());
    assert.deepEqual(labelsAndAria(html).filter((t) => /case|hours|description/i.test(t)), []);
    assert.doesNotMatch(html, /placeholder=|aria-labelledby=|<input[^>]*title=/);
    const buttons = [...html.matchAll(/<button[^>]*>([\s\S]*?)<\/button>/g)].map((m) => m[1]);
    assert.ok(buttons.includes("Start timer"));
    assert.deepEqual(buttons.filter((t) => /save|add entry/i.test(t)), []);
    assert.doesNotMatch(html, /entry (added|saved)/i);
  });
}
test("timer markup: running shows h:mm:ss from startedAt, Stop and the Timer note; stopped shows Discard, no Stop", async () => {
  const { TimerView } = await import("../../app/time/timer.tsx");
  const t = { caseId: "90001", startedAt: T - (2 * 3600 + 4 * 60 + 5) * 1000, description: "" };
  const run = renderToStaticMarkup(React.createElement(TimerView, { timer: t, now: T }));
  assert.match(run, /<span role="timer"[^>]*>2:04:05<\/span>/);
  assert.match(run, />Stop</);
  assert.match(run, /Timer note/);
  const stop = renderToStaticMarkup(React.createElement(TimerView, { timer: { ...t, stoppedAt: T }, now: T + 3600_000 }));
  assert.match(stop, />2:04:05</);
  assert.match(stop, />Discard</);
  assert.doesNotMatch(stop, />Stop</);
});

test("admin markup: Person select, Show button, week preserved, unbilled table", async () => {
  const html = await render({ role: "admin", personId: 1 }, { week: "2026-01-15" });
  assert.match(html, /<label[^>]*>Person<\/label><select[^>]*name="who"/);
  assert.match(html, /<option value="2">JON<\/option>/);
  assert.match(html, /<input type="hidden" name="week" value="2026-01-12"\/>/);
  assert.match(html, /<button type="submit"[^>]*>Show<\/button>/);
  assert.match(html, /Unbilled hours by case/);
  assert.match(html, /href="\/cases\/90001"/);
});
test("guard f: staff markup has neither the Person select nor the unbilled table", async () => {
  const html = await render({ role: "staff", personId: 1 }, { week: "2026-01-15" });
  assert.deepEqual([/name="who"/.test(html), /Unbilled hours by case/.test(html)], [false, false]);
});
test("row markup: date links to /time/<actid>, case # + title, 3-decimal hours, billed marker", async () => {
  const html = await render({ role: "staff", personId: 1 }, { week: "2026-01-15" });
  assert.match(html, /<a class="underline" href="\/time\/11">2026-01-12<\/a>/);
  assert.match(html, /90001 Fixture case/);
  assert.match(html, />1\.250</);
  assert.equal((html.match(/>billed</g) ?? []).length, 2); // rows 13 (actbillid) and 14 (actbilled)
  assert.match(html, /Week total<\/td><td class="text-right">3\.675/);
});
