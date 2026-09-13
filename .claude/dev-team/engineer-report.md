# Engineer Report
**Task:** Item 4 — Notice actions on /bills/[id]: Advance (1st→2nd→Final, stamping the notice date) and Close as (Cancelled / Carried Over / Deadbeat / Settled)
**Branch:** auto/billing (worktree billing-auto) — uncommitted, per orchestrator instruction
**Date:** 2026-09-12

Gate: billing `tsx --test tests/billing/*.test.mjs` → 66 tests, 55 pass, 0 fail, 11 skip (live, no server) · `pnpm test` (gate env) → 584 tests, 507 pass, 1 fail (pre-existing search-e2e "advanced AND/OR/date"), 76 skip — equals baseline · `pnpm typecheck` → clean
Mutations 3/3 caught: A drop `.eq('billnotice', expected)` → test 3 fails · B drop `.is(dateCol, null)` → test 6 fails · C close-target check forced true → test 4 fails (and test 3) · each restored, verified with `cmp`

## Design Decisions
- Write logic in `lib/bills/notice.ts`: `advanceNotice`, `closeBill`, `runNoticeAction(kind, billid, formData, deps)`; deps match EditDeps plus `now: () => Date`.
- Guards live in the write statement: `.eq('billid').eq('billnotice', expected)`, plus `.is(dateCol, null)` for Advance, then `.select('billid')`; a row count other than 1 → `?error=stale`.
- `expected` comes from a hidden input holding the notice the page rendered, so a duplicate or concurrent submit is stale. Concurrent Advance is also caught by the is-null guard.
- Clock seam: existing `firmToday(now: Date)` in lib/cases/presets.ts already takes the date; actions.ts passes `now: () => new Date()` and the tests pin it. No wrapper was needed.
- Moves are allowed only through `isOpen` / `nextNotice` / `CLOSE_AS_NOTICES` imported from rules.ts. `closeTargets(notice)` = close-as set minus the current notice, and empty unless the bill is open.
- Deadbeat → Deadbeat is refused (`?error=move`), not offered, and nothing is written. Deadbeat is legal from any other open notice.
- Close-as writes a payload of only `{ billnotice }`, so both notice dates are left alone. Advance writes only `{ billnotice, <date col> }`. Nothing writes billpaiddate, 'Paid' or 'Partial Payment'.
- The server action re-checks the role with the real `requireSession('admin')`: staff get `?error=forbidden` and no DB call. Moves outside the rules get `?error=move` and no write.
- New error codes `stale` and `move` come from `noticeErrorMessage` in notice.ts. `stale` gets a notice-specific message on the bill page, while the create page keeps its own "entries were billed" wording.
- View: the Advance button ("Advance to 2nd/Final") and the Close-as select + "Close bill" render only for admins and only when the rules allow the move. Forms are keyed on the notice and use the useFormStatus-disabled `SaSubmit`.

## Files Changed
- `lib/bills/notice.ts` — new: guarded notice writes, the action body, `closeTargets`, messages.
- `app/bills/actions.ts` — `advanceBillNotice` / `closeBillAs` server actions pass the real deps.
- `app/bills/[id]/page.tsx` — binds both actions for admins; error text now comes from `noticeErrorMessage`.
- `app/bills/[id]/bill-view.tsx` — admin notice section (Advance form, Close-as form).
- `tests/billing/notice.test.mjs` — 8 tests through `runNoticeAction` with the real requireSession and a fake PostgREST; the file sets `process.env.TZ='UTC'`.

## Deferred / Out of Scope
- No live/Playwright test for the notice buttons; that is left to QA per the lane pattern (render tests cover which buttons show for admin vs staff).
- Nothing committed, per the orchestrator's "don't commit".

## Flags for Reviewer
- A missing bill also returns `?error=stale` (0 rows), not `notfound`; the page 404s on reload anyway.
- Test 3 accepts `move|stale`; which code comes back depends on whether the form's expected notice matches the Paid row.
- The staged deletions of `.claude/dev-team/{engineer,qa}-report.md` were already in the index before this item; I left them untouched.
- Process note: running the two gate commands in parallel (with an orphaned background run still going) produced 70 false failures. Run them one at a time.
