// Billing item 9: "Bill #N" → /bills/N on time rows carrying actbillid, in the case Time panel and the /time week view.
// Pure views rendered with renderToStaticMarkup; every row is found by its description text, never by position.
// BILL (4242) differs from every actid so an href built from the wrong id fails.
import { test } from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

globalThis.React = React; // tsx compiles .tsx with the classic JSX runtime
const { TimePanelView } = await import("../../app/cases/[id]/time-panel.tsx");
const { WeekView } = await import("../../app/time/week-view.tsx");
const { isEditable } = await import("../../lib/time/entries.ts");

const BILL = 4242;
const BILL2 = 4243;
const base = { actdate: "2026-09-09", acthrs: "1.000", actwho: 1, initials: "KJS", actcaseid: 991401, tblcase: { caseid: 991401, casetitle: "T" } };
const ROWS = [
  { ...base, actid: 11, actdescription: "Linked row desc", actbilled: true, actbillid: BILL },
  { ...base, actid: 12, actdescription: "Legacy billed desc", actbilled: true, actbillid: null },
  { ...base, actid: 13, actdescription: "Unbilled row desc", actbilled: false, actbillid: null },
  // link gated on actbillid, not actbilled: this row isolates that gate from the legacy-row one
  { ...base, actid: 14, actdescription: "Billid only desc", actbilled: false, actbillid: BILL2 },
];

/** The one row segment (split on `tag` opening) containing `desc`. */
function rowOf(html, tag, desc) {
  const segs = html.split(new RegExp(`(?=<${tag}[ >])`)).filter((s) => s.includes(desc));
  assert.equal(segs.length, 1, `exactly one <${tag}> row contains ${desc}`);
  return segs[0].slice(0, segs[0].indexOf(`</${tag}>`));
}
const billLinks = (seg) => [...seg.matchAll(/<a[^>]*href="(\/bills\/[^"]*)"[^>]*>([^<]*)<\/a>/g)].map((m) => ({ href: m[1], text: m[2] }));
const text = (html) => html.replace(/<[^>]+>/g, " ");

const panel = renderToStaticMarkup(React.createElement(TimePanelView, { caseId: 991401, rows: ROWS }));
const week = renderToStaticMarkup(React.createElement(WeekView, { monday: "2026-09-07", sunday: "2026-09-13", rows: ROWS, admin: false, who: 1 }));
const panelRow = (d) => rowOf(panel, "li", d);
const weekRow = (d) => rowOf(week, "tr", d);
const weekMarker = (seg) => /<span[^>]*>billed<\/span>/.test(seg);

test("case panel: actbillid row keeps data-testid=billed-marker and links 'Bill #4242' → /bills/4242", () => {
  const r = panelRow("Linked row desc");
  assert.match(r, /data-testid="billed-marker"/);
  assert.deepEqual(billLinks(r), [{ href: "/bills/4242", text: "Bill #4242" }]);
});
test("case panel: legacy billed row (actbillid null) keeps its marker and has no /bills/ link or 'Bill #' text", () => {
  const r = panelRow("Legacy billed desc");
  assert.match(r, /data-testid="billed-marker"/);
  assert.doesNotMatch(r, /\/bills\//);
  assert.doesNotMatch(r, /Bill #/);
});
test("case panel: unbilled row shows neither marker nor link", () => {
  const r = panelRow("Unbilled row desc");
  assert.doesNotMatch(r, /billed-marker/);
  assert.doesNotMatch(r, /\/bills\/|Bill #/);
});
test("case panel: actbilled=false + actbillid=4243 still links (gate is actbillid, not actbilled)", () => {
  assert.deepEqual(billLinks(panelRow("Billid only desc")), [{ href: "/bills/4243", text: "Bill #4243" }]);
});
test("case panel journey-01 trap: link text and panel text never match /bills/i; no buttons, aria-label or title", () => {
  assert.doesNotMatch("Bill #4242", /bills/i);
  assert.doesNotMatch(text(panel), /bills/i);
  assert.doesNotMatch(panel, /<button|aria-label|title=/);
});

test("week view: actbillid row keeps its 'billed' span and links 'Bill #4242' → /bills/4242", () => {
  const r = weekRow("Linked row desc");
  assert.ok(weekMarker(r), "billed span present");
  assert.deepEqual(billLinks(r), [{ href: "/bills/4242", text: "Bill #4242" }]);
});
test("week view: legacy billed row keeps 'billed' and has no /bills/ link or 'Bill #' text", () => {
  const r = weekRow("Legacy billed desc");
  assert.ok(weekMarker(r), "billed span present");
  assert.doesNotMatch(r, /\/bills\/|Bill #/);
});
test("week view: unbilled row shows neither 'billed' nor a bill link", () => {
  const r = weekRow("Unbilled row desc");
  assert.equal(weekMarker(r), false);
  assert.doesNotMatch(r, /\/bills\/|Bill #/);
});
test("week view: actbilled=false + actbillid=4243 still links", () => {
  assert.deepEqual(billLinks(weekRow("Billid only desc")), [{ href: "/bills/4243", text: "Bill #4243" }]);
});
test("week view: every row keeps its /time/<actid> date link; staff view renders no button and no aria-label", () => {
  for (const r of ROWS) assert.match(weekRow(r.actdescription), new RegExp(`href="/time/${r.actid}"`));
  assert.doesNotMatch(week, /<button|aria-label/);
});

// Edit rules unchanged: one fixture per condition, so each half of isEditable is the only thing that can fail its test.
test("isEditable: actbilled=false with actbillid set → not editable", () => {
  assert.equal(isEditable({ actbilled: false, actbillid: 7 }), false);
});
test("isEditable: actbilled=true with actbillid null → not editable", () => {
  assert.equal(isEditable({ actbilled: true, actbillid: null }), false);
});
test("isEditable: unbilled row → editable", () => {
  assert.equal(isEditable({ actbilled: false, actbillid: null }), true);
});
