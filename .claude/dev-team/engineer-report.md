# Engineer Report
**Task:** billing item 7 — recipient alert banner + CC line on /bills/new and /bills/[id]
**Branch:** auto/billing (uncommitted — orchestrator commits)
**Date:** 2026-09-12

Files changed: app/bills/recipient-alert.tsx (new), app/bills/[id]/bill-view.tsx, app/bills/new/new-bill-form.tsx, lib/bills/edit.ts, lib/bills/create.ts, tests/billing/recipient-alert.test.mjs (new), tests/billing/recipient-alert.live.test.mjs (new)
Gate `pnpm test` (ta_billing_gate): 584 tests — 507 pass, 1 fail, 76 skip (= baseline; fail is the known search-e2e "advanced AND/OR/date via runSearch…")
Gate billing glob, server stopped: 140 tests — 116 pass, 0 fail, 24 skip
Gate typecheck: clean
New unit file: 10/10 pass. Live file (server up): 4/4 pass, 0 skip; leftovers on 991000–991099 after run: 0 cases, 0 bills

## Design Decisions
- `RecipientAlert({alert, cc})` pure component, no role (avoids clashing with existing role=alert/status locators); `cc?.trim()` makes null/''/whitespace empty; CC text rendered as one escaped string.
- `billingalert`/`billingcc` added to the existing single tblcase select in `loadBill` and `loadNewBill`, and to `BillPageData`/`NewBillData`; pages unchanged (data already flows through).
- No save-path change at all — create/edit never read or write the two columns.

## Mutation → catching test (all 13 run in place and reverted; each caught)
- banner always shown → "BillView/NewBillForm: alert false + non-empty cc → no banner, CC line still shown"
- banner never shown → "BillView: alert true + cc … → banner once and CC line" (also NewBillForm twin, empty-cc test)
- CC only when alert true → "BillView/NewBillForm: alert false + non-empty cc → no banner, CC line still shown" (only these)
- CC shown for empty/whitespace (no trim, or `cc ?? …` when alert) → "empty cc (null / '' / whitespace) → no CC line on either view; banner follows the alert alone" (only this)
- component dropped from bill page only → "BillView: alert true + cc 'a@x.test, b@x.test' → banner once and CC line with both addresses"
- component dropped from /bills/new only → "NewBillForm: alert true + cc 'a@x.test, b@x.test' → banner once and CC line with both addresses"
- `billingalert` dropped from loader select → unit "loadBill passes …" / "loadNewBill passes …" (fake projects select columns); live "alert case: /bills/new?case=991001 …" and "alert case: its bill page …" went red (verified live)
- save path refusing/altering when alert true → "display-only: runCreateBill on an alert + cc case redirects to the new bill and inserts exactly the typed bill" / "display-only: runEditBill on an alert + cc case saves the edited columns unchanged"
- any write to tblcase → "display-only: create + edit on an alert + cc case record zero insert/update/upsert/delete calls against tblcase" (only this; a create-refuses mutant also trips it via its redirect assertion)

## Deferred / Out of Scope
- Staff view of /bills/new shows no form, so no alert there (page is admin-only by design).

## Flags for Reviewer
- Live file uses case range 991000–991099 (no other suite uses it); admin-only sign-in (throwaway admin), no staff login.
- Stale `tests/app-shell/shell.live.test.mjs` "signed-in GET /bills (unbuilt) → 404" not touched (not run with server up in the full gate).
