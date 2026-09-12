// Unit tests for lib/time/case.ts and app/cases/[id]/time-panel.tsx (fake PostgREST, pattern: tests/cases/create.test.mjs).
// The fake APPLIES eq/order to its rows, so dropping a filter or flipping an order changes what comes back.
// Each guard has one named test ("guard <letter>"), built so a single mutation trips only that guard.
import { test } from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { listCaseTime, unbilledHours } from "../../lib/time/case.ts";
import { TimePanel, TimePanelView } from "../../app/cases/[id]/time-panel.tsx";

globalThis.React = React; // tsx compiles .tsx with the classic JSX runtime

function fakeDb(tables, { fail } = {}) {
  return {
    from(table) {
      const q = { filters: [], orders: [] };
      const b = new Proxy({}, {
        get(_, k) {
          if (k === "then") {
            if (fail === table) return (res, rej) => Promise.resolve({ data: null, error: { message: "boom" } }).then(res, rej);
            let rows = (tables[table] ?? []).filter((r) => q.filters.every((f) => f(r)));
            for (const [col, asc] of [...q.orders].reverse()) rows = [...rows].sort((x, y) => (x[col] < y[col] ? -1 : x[col] > y[col] ? 1 : 0) * (asc ? 1 : -1));
            return (res, rej) => Promise.resolve({ data: rows, error: null }).then(res, rej);
          }
          return (...a) => {
            if (k === "eq") q.filters.push((r) => r[a[0]] === a[1]);
            if (k === "order") q.orders.push([a[0], a[1]?.ascending !== false]);
            return b;
          };
        },
      });
      return b;
    },
  };
}

const act = (actid, actcaseid, actdate, acthrs, actwho, actdescription, { billed = false, billid = null } = {}) =>
  ({ actid, actcaseid, actdate, actdescription, acthrs, actwho, actbilled: billed, actbillid: billid });
// Fixture shape (tests/foundation/fixtures/rows.ts): actid 1 KJS 2.000 unbilled, actid 2 JON 1.500 billed (actbillid null).
const FIXTURE = [act(1, 90001, "2026-01-15", "2.000", 1, "Site inspection"), act(2, 90001, "2026-01-16", "1.500", 2, "Photo review", { billed: true })];
const NAMES = [{ personid: 1, initials: "KJS" }, { personid: 2, initials: "JON" }];
const text = (html) => html.replace(/<[^>]+>/g, " ").replace(/&[a-z#0-9]+;/g, " ").replace(/\s+/g, " ").trim();
const rowTexts = (html) => [...html.matchAll(/<li[^>]*data-testid="time-row"[^>]*>(.*?)<\/li>/g)].map((m) => text(m[1]));
const render = (rows, caseId = 90001) => renderToStaticMarkup(React.createElement(TimePanelView, { caseId, rows }));

test("guard A caseid filter: a row on another case is not listed", async () => {
  const rows = await listCaseTime(fakeDb({ tblactivity: [...FIXTURE, act(9, 90003, "2026-02-01", "4.000", 1, "Other case row")], tblbillingnames: NAMES }), 90001);
  assert.deepEqual(rows.map((r) => r.actid).sort(), [1, 2]);
});

test("guard B ordering: newest actdate first, same-day tie broken by actid desc", async () => {
  const same = [act(5, 90001, "2026-03-01", "1", 1, "a"), act(7, 90001, "2026-03-01", "1", 1, "b"), act(3, 90001, "2026-01-01", "1", 1, "c"), act(4, 90001, "2026-04-01", "1", 1, "d")];
  const rows = await listCaseTime(fakeDb({ tblactivity: same, tblbillingnames: NAMES }), 90001);
  assert.deepEqual(rows.map((r) => r.actid), [4, 7, 5, 3]);
});

test("guard C initials lookup: actwho → tblbillingnames.personid (1 = KJS, 2 = JON, unknown/null = blank)", async () => {
  const rows = await listCaseTime(fakeDb({ tblactivity: [...FIXTURE, act(8, 90001, "2026-01-10", "1", 99, "x"), act(6, 90001, "2026-01-09", "1", null, "y"), act(12, 90001, "2026-01-11", "1", 2, "z")], tblbillingnames: NAMES }), 90001);
  // actid 12 ≠ actwho 2: a join on actid instead of actwho must go red
  assert.deepEqual(Object.fromEntries(rows.map((r) => [r.actid, r.initials])), { 1: "KJS", 2: "JON", 8: "", 6: "", 12: "JON" });
});

test("guard D unbilledHours actbilled cond: actbilled=true with actbillid null is excluded", () => {
  assert.equal(unbilledHours([{ acthrs: "2.000", actbilled: false, actbillid: null }, { acthrs: "1.500", actbilled: true, actbillid: null }]), "2.000");
});

test("guard E unbilledHours actbillid cond: actbilled=false with actbillid set is excluded", () => {
  assert.equal(unbilledHours([{ acthrs: "2.000", actbilled: false, actbillid: null }, { acthrs: "0.250", actbilled: false, actbillid: 5 }]), "2.000");
});

test("unbilledHours sums exactly in thousandths and empty → 0.000", () => {
  assert.equal(unbilledHours([{ acthrs: "0.1", actbilled: false, actbillid: null }, { acthrs: 0.2, actbilled: false, actbillid: null }]), "0.300");
  assert.equal(unbilledHours([]), "0.000");
});

test("guard F billed marker from actbilled: actbilled=true, actbillid null → marker", () => {
  const [r] = rowTexts(render([{ ...FIXTURE[1], initials: "JON" }]));
  assert.equal(r, "2026-01-16 JON 1.500 Photo review billed");
});

test("guard G billed marker from actbillid: actbilled=false, actbillid set → marker", () => {
  const [r] = rowTexts(render([{ ...act(3, 90001, "2026-01-17", "0.5", 1, "Billed by id", { billid: 12 }), initials: "KJS" }]));
  assert.equal(r, "2026-01-17 KJS 0.500 Billed by id billed");
});

test("done-when fixture: panel over fake-client data shows KJS row (no marker), JON row (billed), Unbilled hours: 2.000", async () => {
  const html = renderToStaticMarkup(await TimePanel({ caseId: 90001, db: fakeDb({ tblactivity: FIXTURE, tblbillingnames: NAMES }) }));
  assert.deepEqual(rowTexts(html), ["2026-01-16 JON 1.500 Photo review billed", "2026-01-15 KJS 2.000 Site inspection"]);
  assert.match(text(html), /Unbilled hours: 2\.000/);
});

test("guard H empty branch: no rows → 'No time entries' and 'Unbilled hours: 0.000', no row items", () => {
  const html = render([]);
  assert.match(text(html), /^Time No time entries Unbilled hours: 0\.000 Add entry Start timer$/);
  assert.equal(rowTexts(html).length, 0);
});

test("guard I link target: 'Add entry' and 'Start timer' are links to /time?case=<caseid>", () => {
  const html = render([], 90001);
  const links = [...html.matchAll(/<a[^>]*href="([^"]*)"[^>]*>([^<]*)<\/a>/g)].map((m) => [m[2], m[1]]);
  assert.deepEqual(links, [["Add entry", "/time?case=90001"], ["Start timer", "/time?case=90001"]]);
  assert.doesNotMatch(html, /<button|<input|<form|<label/);
});

test("guard J selector traps: panel text has no /bills/i and no /firm|attorney|client/i (rows, empty, error)", () => {
  for (const html of [render([{ ...FIXTURE[1], initials: "JON" }]), render([]), render(null)]) {
    assert.equal((text(html).match(/bills/gi) ?? []).length, 0);
    assert.doesNotMatch(text(html), /firm|attorney|client/i);
  }
});

test("failed read: panel shows a note instead of throwing, links still present", async () => {
  for (const fail of ["tblactivity", "tblbillingnames"]) {
    const html = renderToStaticMarkup(await TimePanel({ caseId: 90001, db: fakeDb({ tblactivity: FIXTURE, tblbillingnames: NAMES }, { fail }) }));
    assert.match(text(html), /^Time Time entries could not be loaded\. Add entry Start timer$/, fail);
  }
});
