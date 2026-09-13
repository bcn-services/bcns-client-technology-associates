// Unit tests for the header running-timer indicator: lib/time/timer.ts formatHm/indicatorView and the
// server pass of app/time/running-indicator.tsx. Guards are named "guard <letter>" to match mutation targets.
import { test } from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { formatHm, indicatorView, TIMER_EVENT, TIMER_KEY } from "../../lib/time/timer.ts";
import { RunningIndicator } from "../../app/time/running-indicator.tsx";

globalThis.React = React; // tsx compiles .tsx with the classic JSX runtime

const S = 1000, MIN = 60 * S, H = 60 * MIN;
const T0 = Date.UTC(2026, 0, 15, 14, 0, 0);
// Distinct values: caseId 90417 never equals any minute/hour count used below.
const raw = (extra = {}) => JSON.stringify({ caseId: "90417", startedAt: T0, description: "draft", ...extra });

test("formatHm: h:mm, floored minutes, never negative", () => {
  assert.equal(formatHm(0), "0:00");
  assert.equal(formatHm(59 * S), "0:00");
  assert.equal(formatHm(61 * MIN), "1:01");
  assert.equal(formatHm(10 * H + 23 * MIN + 45 * S), "10:23");
  assert.equal(formatHm(-3 * MIN), "0:00");
});

test("indicatorView: running timer → case + elapsed h:mm, not stopped", () => {
  assert.deepEqual(indicatorView(raw(), T0 + 2 * H + 7 * MIN), { caseId: "90417", stopped: false, text: "⏱ Case 90417 · 2:07" });
});

test("indicatorView: stopped timer → frozen elapsed plus 'stopped', independent of now", () => {
  const v = indicatorView(raw({ stoppedAt: T0 + 42 * MIN }), T0 + 5 * H);
  assert.deepEqual(v, { caseId: "90417", stopped: true, text: "⏱ Case 90417 · 0:42 stopped" });
});

test("guard b: absent key → null", () => {
  assert.equal(indicatorView(null, T0), null);
  assert.equal(indicatorView(undefined, T0), null);
  assert.equal(indicatorView("", T0), null);
});

test("guard c: invalid JSON / wrong shapes → null, never throws", () => {
  const bad = ["{not json", "null", "42", '"str"', "[]", "{}",
    JSON.stringify({ caseId: 90417, startedAt: T0, description: "" }),
    JSON.stringify({ caseId: "90417", startedAt: "yesterday", description: "" }),
    JSON.stringify({ caseId: "90417", startedAt: T0 }),
    JSON.stringify({ caseId: "90417", startedAt: T0, description: "", stoppedAt: "later" })];
  for (const b of bad) assert.equal(indicatorView(b, T0 + MIN), null, b);
});

test("indicator text never matches journey-02 case-page selectors or the /bills/i heading", () => {
  for (const v of [indicatorView(raw(), T0 + 3 * MIN), indicatorView(raw({ stoppedAt: T0 + 3 * MIN }), T0)]) {
    assert.doesNotMatch(v.text, /firm|attorney|client|bills|delete|entry (added|saved)/i);
  }
});

test("guard a: server render is empty even with a valid timer stored", () => {
  const prev = globalThis.localStorage;
  globalThis.localStorage = { getItem: (k) => (k === TIMER_KEY ? raw() : null), setItem() {}, removeItem() {} };
  try {
    assert.equal(renderToStaticMarkup(React.createElement(RunningIndicator, { now: () => T0 + 5 * MIN })), "");
  } finally {
    globalThis.localStorage = prev;
  }
});

test("same-tab event name is exported for timer.tsx and the indicator", () => assert.equal(typeof TIMER_EVENT, "string"));
