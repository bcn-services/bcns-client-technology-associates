"use client";

import { useEffect, useState } from "react";
import { TIMER_EVENT, TIMER_KEY, elapsedMs, fillFor, formatElapsed, parseTimer, startTimer, stopTimer, type Fill, type TimerState } from "@/lib/time/timer";

// Reuses the EntryForm's own fields (ids from entry-form.tsx); the timer renders no Case/Hours control.
const FIELD_IDS: Record<keyof Fill, string> = { case: "t-case", date: "t-date", hours: "t-hours", description: "t-description" };
const field = (k: keyof Fill) => document.getElementById(FIELD_IDS[k]) as HTMLInputElement | HTMLTextAreaElement | null;
const fillForm = (f: Partial<Fill>) => (Object.keys(f) as (keyof Fill)[]).forEach((k) => { const el = field(k); if (el) el.value = f[k] ?? ""; });

const changed = () => window.dispatchEvent(new Event(TIMER_EVENT)); // tells the header indicator in this tab
const store = {
  get: () => { try { return localStorage.getItem(TIMER_KEY); } catch { return null; } },
  set: (s: TimerState) => { try { localStorage.setItem(TIMER_KEY, JSON.stringify(s)); } catch { /* storage blocked: timer lives only in this tab */ } changed(); },
  clear: () => { try { localStorage.removeItem(TIMER_KEY); } catch { /* ignore */ } changed(); },
};

const btn = "rounded border border-slate-300 px-3 py-1 text-sm hover:bg-slate-50";

/** Presentational half, exported so the server-rendered markup of every state can be unit-tested. */
export function TimerView({ timer, now, message, onStart, onStop, onDiscard, onNote }: {
  timer: TimerState | null;
  now: number;
  message?: string;
  onStart?: () => void;
  onStop?: () => void;
  onDiscard?: () => void;
  onNote?: (v: string) => void;
}) {
  return (
    <section className="flex max-w-xl flex-wrap items-center gap-3 rounded border border-slate-200 p-3 text-sm">
      <button type="button" onClick={onStart} className={btn}>Start timer</button>
      {timer && (
        <>
          <span role="timer" className="font-mono tabular-nums">{formatElapsed(elapsedMs(timer, now))}</span>
          {timer.stoppedAt === undefined ? (
            <button type="button" onClick={onStop} className={btn}>Stop</button>
          ) : (
            <button type="button" onClick={onDiscard} className={btn}>Discard</button>
          )}
          {timer.stoppedAt === undefined && (
            <label className="flex items-center gap-2">
              Timer note
              <input value={timer.description} onChange={(e) => onNote?.(e.target.value)} className="rounded border border-slate-300 px-2 py-1" />
            </label>
          )}
        </>
      )}
      {message && <p role="alert" className="w-full text-amber-800">{message}</p>}
    </section>
  );
}

/**
 * Start/stop timer above the /time entry form. `clearOnAdded` (the ?added=1 render) drops a stopped
 * timer's key — its entry was just inserted. A still-running timer survives an unrelated manual add.
 */
export function Timer({ now = Date.now, clearOnAdded = false }: { now?: () => number; clearOnAdded?: boolean }) {
  const [timer, setTimer] = useState<TimerState | null>(null);
  const [tick, setTick] = useState(0);
  const [message, setMessage] = useState("");

  useEffect(() => {
    const s = parseTimer(store.get());
    if (s?.stoppedAt !== undefined && clearOnAdded) { store.clear(); setTimer(null); return; }
    setTimer(s);
    setTick(now());
    // Reload after Stop: re-fill the server-rendered form, unless it already echoes typed values (?error=).
    if (s?.stoppedAt !== undefined && !field("hours")?.value) fillForm(fillFor(s));
  }, [clearOnAdded, now]);

  const running = !!timer && timer.stoppedAt === undefined;
  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => setTick(now()), 1000);
    return () => clearInterval(id);
  }, [running, now]);

  const save = (s: TimerState | null) => { if (s) store.set(s); else store.clear(); setTimer(s); setTick(now()); };

  return (
    <TimerView
      timer={timer}
      now={tick}
      message={message}
      onStart={() => {
        const r = startTimer(store.get(), field("case")?.value ?? "", "", now()); // fresh read: another tab may hold a timer
        setMessage("error" in r ? r.error : "");
        if ("state" in r) save(r.state);
      }}
      onStop={() => {
        if (!timer) return;
        const s = stopTimer(timer, now());
        save(s);
        fillForm(fillFor(s));
        setMessage("");
      }}
      onDiscard={() => {
        save(null);
        fillForm({ hours: "", description: "" });
        setMessage("");
      }}
      onNote={(v) => timer && save({ ...timer, description: v })}
    />
  );
}
