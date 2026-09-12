"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { TIMER_EVENT, TIMER_KEY, indicatorView } from "@/lib/time/timer";

const read = () => { try { return localStorage.getItem(TIMER_KEY); } catch { return null; } };

/**
 * Header link to /time for a running (or stopped, unsaved) timer. Reads localStorage only in effects,
 * so the server pass and first client render are empty (no hydration mismatch). Re-reads each minute,
 * on the same-tab TIMER_EVENT, on `storage` (other tabs), and on every client navigation.
 * Deliberately no aria-label/title: /time's getByLabel(/case/i) must stay strict.
 */
export function RunningIndicator({ now = Date.now }: { now?: () => number }) {
  const [text, setText] = useState<string | null>(null);
  const pathname = usePathname();

  useEffect(() => {
    const refresh = () => setText(indicatorView(read(), now())?.text ?? null);
    refresh();
    const id = setInterval(refresh, 60_000);
    window.addEventListener(TIMER_EVENT, refresh);
    window.addEventListener("storage", refresh);
    return () => {
      clearInterval(id);
      window.removeEventListener(TIMER_EVENT, refresh);
      window.removeEventListener("storage", refresh);
    };
  }, [pathname, now]);

  if (!text) return null;
  return (
    <Link href="/time" data-testid="running-indicator" className="rounded bg-amber-50 px-2 py-1 text-sm font-medium tabular-nums text-amber-900 hover:bg-amber-100">
      {text}
    </Link>
  );
}
