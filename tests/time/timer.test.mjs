// Unit tests for lib/time/timer.ts (pure; injected clock). Guards are named "guard <letter>" to match mutation targets.
import { test } from "node:test";
import assert from "node:assert/strict";
import { TIMER_KEY, NEED_CASE, ONE_TIMER, roundHours, formatElapsed, parseTimer, startTimer, stopTimer, elapsedMs, fillFor } from "../../lib/time/timer.ts";
import { firmToday } from "../../lib/cases/presets.ts";

const S = 1000, MIN = 60 * S, H = 60 * MIN;
const T0 = Date.UTC(2026, 0, 15, 14, 0, 0); // 09:00 in New York
const stopAfter = (ms) => fillFor(stopTimer({ caseId: "90001", startedAt: T0, description: "d" }, T0 + ms)).hours;

test("key name is ta.timer", () => assert.equal(TIMER_KEY, "ta.timer"));

// The four done-when cases, one test each, driven through start → stop → fill with an injected clock.
test("guard a: Stop after 3 s fills 0.125 (floor of one eighth)", () => assert.equal(stopAfter(3 * S), "0.125"));
test("done-when: Stop after 7 min fills 0.125", () => assert.equal(stopAfter(7 * MIN), "0.125"));
test("guard c: Stop after 40 min fills 0.625 (rounds, not ceil)", () => assert.equal(stopAfter(40 * MIN), "0.625"));
test("guard b: Stop after 2 h 4 min fills 2.125 (rounds, not floor)", () => assert.equal(stopAfter(2 * H + 4 * MIN), "2.125"));
test("guard d: step is exactly 0.125 h — 22.5 min → 0.375, 1 h → 1, 1 h 7.5 min → 1.125", () => {
  assert.deepEqual([roundHours(22.5 * MIN), roundHours(H), roundHours(H + 7.5 * MIN)], ["0.375", "1", "1.125"]);
});
test("roundHours: 0 ms and negative clock skew still give the 0.125 floor; long runs have no float drift", () => {
  assert.equal(roundHours(0), "0.125");
  assert.equal(roundHours(-5 * MIN), "0.125");
  assert.equal(roundHours(23 * H + 52.5 * MIN), "23.875");
});

test("formatElapsed: h:mm:ss", () => {
  assert.deepEqual([formatElapsed(0), formatElapsed(3 * S), formatElapsed(40 * MIN + 5 * S), formatElapsed(2 * H + 4 * MIN), formatElapsed(-1)], ["0:00:00", "0:00:03", "0:40:05", "2:04:00", "0:00:00"]);
});

test("guard e: Start with an empty (or blank) Case is refused with 'Enter a case number first'", () => {
  assert.deepEqual(startTimer(null, "", "", T0), { error: NEED_CASE });
  assert.deepEqual(startTimer(null, "   ", "", T0), { error: NEED_CASE });
  assert.equal(NEED_CASE, "Enter a case number first");
});
test("guard f: Start while a timer is stored (running or stopped) is refused with 'Stop the running timer first'", () => {
  const running = JSON.stringify({ caseId: "90001", startedAt: T0, description: "" });
  assert.deepEqual(startTimer(running, "90002", "", T0 + H), { error: ONE_TIMER });
  assert.deepEqual(startTimer(JSON.stringify({ ...JSON.parse(running), stoppedAt: T0 + H }), "90002", "", T0 + H), { error: ONE_TIMER });
  assert.equal(ONE_TIMER, "Stop the running timer first");
});
test("Start with a case and no key stores { caseId, startedAt: now, description }", () => {
  assert.deepEqual(startTimer(null, " 90001 ", "", T0), { state: { caseId: "90001", startedAt: T0, description: "" } });
});

test("parseTimer: bad JSON / wrong shape → null, so a corrupt key never blocks Start", () => {
  for (const raw of [null, "", "{", "null", "[]", '{"caseId":90001,"startedAt":1,"description":""}', '{"caseId":"1","startedAt":"x","description":""}', '{"caseId":"1","startedAt":1,"description":"","stoppedAt":"x"}'])
    assert.equal(parseTimer(raw), null, raw);
  assert.ok("state" in startTimer("{", "90001", "", T0));
  assert.deepEqual(parseTimer('{"caseId":"1","startedAt":5,"description":"n","stoppedAt":9}'), { caseId: "1", startedAt: 5, description: "n", stoppedAt: 9 });
});

test("reload mid-run: elapsed counts from the stored startedAt, not from the reload", () => {
  const s = parseTimer(JSON.stringify({ caseId: "90001", startedAt: T0, description: "" }));
  assert.equal(elapsedMs(s, T0 + 40 * MIN), 40 * MIN);
});
test("Stop fills case, firm-local date of the stop, rounded hours and the draft note; stopping twice keeps the first stop", () => {
  const s = stopTimer({ caseId: "90001", startedAt: T0, description: "Reviewed file" }, T0 + 40 * MIN);
  assert.deepEqual(fillFor(s), { case: "90001", date: firmToday(new Date(T0 + 40 * MIN)), hours: "0.625", description: "Reviewed file" });
  assert.equal(stopTimer(s, T0 + 5 * H), s);
  assert.equal(elapsedMs(s, T0 + 5 * H), 40 * MIN, "a stopped timer no longer ticks");
});
test("Stop date is America/New_York: 03:30 UTC on 2026-01-16 is still 2026-01-15 at the firm", () => {
  const start = Date.UTC(2026, 0, 16, 3, 0);
  assert.equal(fillFor(stopTimer({ caseId: "1", startedAt: start, description: "" }, start + 30 * MIN)).date, "2026-01-15");
});
