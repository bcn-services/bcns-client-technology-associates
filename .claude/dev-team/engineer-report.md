# Engineer Report
**Task:** Item 5 — Revise an open, not-yet-superseded bill on /bills/[id] (lib/bills/revise.ts)
**Branch:** auto/billing (worktree billing-auto) — uncommitted, per orchestrator instruction
**Date:** 2026-09-12

Gate: billing 96 tests / 80 pass / 0 fail / 16 skip · typecheck clean · full suite 584 / 507 pass / 1 fail (pre-existing search-e2e) / 76 skip
Mutations: 5/5 red (superseded check, isOpen check, move-count check, cancel compensation, button revisedBy check); all restored, cmp ok

## Design Decisions
- `reviseBill`: read B → isOpen (move) → notice === expected (stale) → no bill with supersedesbillid=B (`revised`) → count B's rows → insert B′ → move rows `.eq(actbillid,B)` with count check → `guardedUpdate(B, expected, {billnotice:'Cancelled'})`.
- On a move-count mismatch or a failed cancel: rows `where actbillid=B′` go back to B, then B′ is deleted, then `?error=stale`. Non-transactional (same caveat as create.ts), marked `ponytail:` in code.
- Concurrency: when both revises see rows, the loser's move gets 0 rows and compensates. When neither sees rows, the cancel guard picks the winner. The loser's undo only touches rows on its own fresh B′.
- The row move writes only `{actbillid}`; `actbilled` stays true, so the case's unbilled hours don't change.
- `runRevise` lives in `lib/bills/revise.ts`, not `app/bills/actions.ts`. That file is `"use server"`, so any function exported from it becomes a client-callable action, and deps can't be serialized. This matches runNoticeAction/runCreateBill. actions.ts has only the `reviseBillAction` wrapper.
- Extracted `fileNameFor` from create.ts and exported `guardedUpdate` from notice.ts, so revise imports them instead of re-deriving them.

## Files Changed
- `lib/bills/revise.ts` — new: reviseBill + runRevise (admin check, then id check, then redirect to /bills/<B′> or ?error=)
- `lib/bills/create.ts` — `fileNameFor(db, caseId, attyLastName, billdate)` extracted; createBill uses it (behavior unchanged)
- `lib/bills/notice.ts` — `guardedUpdate` exported
- `lib/bills/edit.ts` — `revised` error message
- `app/bills/actions.ts` — `reviseBillAction` server action
- `app/bills/[id]/page.tsx` — passes the bound revise action (admin only)
- `app/bills/[id]/bill-view.tsx` — Revise button shown only when admin + revise prop + isOpen + revisedBy empty; posts hidden `expected`. The "Revises #"/"Revised by #" links already existed.
- `tests/billing/revise.test.mjs` — 12 tests: done-when 1/3/4, superseded-only, closed, stale expected, staff, 2 compensation paths, 2 concurrency cases, button render, links

## Deferred / Out of Scope
- No live/Playwright test for revise; QA owns it.

## Flags for Reviewer
- The superseded check is a pre-read, because an insert can't be guarded over PostgREST. Concurrent safety comes from the move count and the cancel guard, not from that read.
- If the compensation itself fails, the orphan B′ is only logged with console.error, as in createBill.
