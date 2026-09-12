/**
 * Start/stop timer for /time — pure logic; app/time/timer.tsx owns localStorage and the DOM.
 * State lives in localStorage only (never the DB) under TIMER_KEY as JSON:
 *   { "caseId": "90001", "startedAt": 1757680000000, "description": "draft note", "stoppedAt"?: 1757682400000 }
 * startedAt/stoppedAt are epoch ms from the injected clock. stoppedAt present = stopped, form filled,
 * awaiting "Add entry" (key cleared on the ?added=1 render) or "Discard".
 */
import { firmToday } from "../cases/presets";

export const TIMER_KEY = "ta.timer";
export const NEED_CASE = "Enter a case number first";
export const ONE_TIMER = "Stop the running timer first";

export type TimerState = { caseId: string; startedAt: number; description: string; stoppedAt?: number };
export type Fill = { case: string; date: string; hours: string; description: string };

const EIGHTH_MS = 450_000; // 0.125 h

/** Elapsed ms → hours string rounded to the nearest 0.125, never below 0.125 (integer eighths, no float drift). */
export function roundHours(ms: number): string {
  return String(Math.max(1, Math.round(ms / EIGHTH_MS)) / 8);
}

/** Elapsed ms → "h:mm:ss". */
export function formatElapsed(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${Math.floor(s / 3600)}:${pad(Math.floor(s / 60) % 60)}:${pad(s % 60)}`;
}

/** Stored value → state; missing, unparseable or wrong-shaped → null (treated as no timer, so Start can recover). */
export function parseTimer(raw: string | null | undefined): TimerState | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw);
    if (!v || typeof v.caseId !== "string" || !Number.isFinite(v.startedAt) || typeof v.description !== "string") return null;
    if (v.stoppedAt !== undefined && !Number.isFinite(v.stoppedAt)) return null;
    return v as TimerState;
  } catch {
    return null;
  }
}

/** Start: refused while any timer (running or stopped) is stored, or when the form's Case is empty. */
export function startTimer(raw: string | null, caseValue: string, description: string, now: number): { error: string } | { state: TimerState } {
  if (parseTimer(raw)) return { error: ONE_TIMER };
  const caseId = caseValue.trim();
  if (!caseId) return { error: NEED_CASE };
  return { state: { caseId, startedAt: now, description } };
}

export const elapsedMs = (s: TimerState, now: number) => (s.stoppedAt ?? now) - s.startedAt;

/** Stop at `now`: the stored state gains stoppedAt; rounding happens here, client-side, only. */
export function stopTimer(s: TimerState, now: number): TimerState {
  return s.stoppedAt === undefined ? { ...s, stoppedAt: now } : s;
}

/** Values a stopped timer writes into the entry form. Date is the firm-local day of the stop. */
export function fillFor(s: TimerState): Fill {
  const stoppedAt = s.stoppedAt ?? s.startedAt;
  return { case: s.caseId, date: firmToday(new Date(stoppedAt)), hours: roundHours(stoppedAt - s.startedAt), description: s.description };
}
