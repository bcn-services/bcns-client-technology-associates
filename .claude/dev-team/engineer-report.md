# Engineer Report
**Task:** Item 3 of 9: Create bill at `/bills/new?case=<id>` (ui: true)
**Branch:** auto/billing (worktree billing-auto; nothing committed, the orchestrator commits)
**Date:** 2026-09-12
**Gate:** billing unit 42 tests: 36 pass / 0 fail / 6 skip (live, no server), up from 15 · typecheck clean · `pnpm test` 584: 507 pass / 1 fail (pre-existing search-e2e) / 76 skip, same as baseline

## Design Decisions
- `runCreateBill(formData, deps)` lives in `lib/bills/create.ts`, next to `runEditBill` in edit.ts. The action in `app/bills/actions.ts` passes the real `requireSession("admin")`. A staff POST redirects to `?error=forbidden` before any DB call.
- Pre-check before the insert: `select tblactivity where actid in (ids) and actcaseid=<case> and actbilled=false and actbillid is null`. A count mismatch throws `stale` with nothing written. This also covers a checked actid from another case. Hours are summed from these DB rows via `thousandths`/`fmtHours`. The action never reads an hours or total field.
- Claim: `.update({actbilled:true, actbillid}).in('actid', ids).eq('actbilled', false).is('actbillid', null).select('actid')`. If the count is off (or there's an error), rows are reverted with `.eq('actbillid', new)`, the new bill is deleted, and the action throws `stale`. The claim is skipped when nothing is checked.
- `billhours` is sent as fmtHours text ("2.000"). Migration 0006 made the column numeric(9,3), so the sum is stored exactly.
- Filename n = the number of rows on this case with the same `billdate`. Case with no `tblattorney` row: `billfilename` is null (the admin can set it on the bill page). This avoids a double-space name.
- Form is a client component (`new-bill-form.tsx`). Changing the type re-checks rows (timesheet = all checked, other types = none). It shows "Unbilled hours: X" (the case total) and a display-only "Selected: X h". The submit is `SaSubmit` ("Create bill", disabled by `useFormStatus`). The page keys the form with `Date.now()`, so each render remounts it.
- Page: staff see "Only admins can create bills." and no form. A bad `?case` or missing case gives notFound. Bill date defaults to `firmToday(new Date())`.
- Journey-03 strictness: one element with "unbilled hours", one label matching /balance/i, one form button. The shell's only button is "Sign out". The render test checks this.

## Files Changed
- `lib/bills/create.ts`: new. Contains `parseBillCreate`, `loadNewBill` (reuses listCaseTime), `createBill` (guarded write plus compensation) and `runCreateBill`.
- `app/bills/actions.ts`: added the `createBill` server action.
- `app/bills/new/page.tsx`: new admin-only page.
- `app/bills/new/new-bill-form.tsx`: new client form view.
- `lib/bills/edit.ts`: exported `BALANCE_RE` (shared with create); added `notice`/`case`/`stale` messages to `billErrorMessage`.
- `tests/billing/create-bill.test.mjs`: 11 tests against a stateful fake PostgREST. They drive `runCreateBill` with the real requireSession and cover all 4 done-when criteria, the race compensation (a hook bills a row between the read and the claim), a cross-case actid, a forged hours field, the no-attorney case, validation, and the form render.

## Deferred / Out of Scope
- Not run: journey 03 and a live staff replay (they need a dev server and Playwright). These are QA's.
- A validation error doesn't re-fill the typed values (same as the edit page).

## Flags for Reviewer
- The compensation isn't transactional. If the revert or delete fails, it's logged with `console.error` and an orphan bill can remain (marked `ponytail:` in create.ts).
- The stale redirect triggers on a count mismatch from either the pre-check or the claim. The pre-check means most stale saves write nothing at all.
- `loadNewBill` reads through `listCaseTime`, which is one unpaged read (1000-row cap, the time lane's ponytail).
