# Engineer Report
**Task:** Billing item 9: wire bills into time screens ("Bill #N" → /bills/N on tblactivity rows with actbillid)
**Branch:** auto/billing (worktree .claude/worktrees/billing-auto), uncommitted per orchestrator
**Date:** 2026-09-12
**Gate pnpm test (ta_billing_gate):** 584 tests, 507 pass, 1 fail, 76 skip. Same as baseline; the fail is the known search-e2e "advanced AND/OR/date via runSearch"
**Gate billing glob (server stopped):** 184 tests, 154 pass, 0 fail, 30 skip (live files skip)
**Gate typecheck:** pass (tsc --noEmit exit 0)
**Live tests/billing/time-bill-links.live.test.mjs:** 2 pass, 0 fail; 0 leftover rows in 991400–991499 (tblactivity/tblbills/tblcase)
**Live tests/time/case-panel.live.test.mjs:** 2 pass, 0 fail
**Journey 01 (tests/journeys/01-legacy-data.spec.ts):** 1 passed

## Design Decisions
- One shared `BillLink` in `app/bills/bill-link.tsx`, used by both views. It renders nothing when `billId == null`. The link is gated on actbillid, not isBilled.
- There is one null guard only, inside BillLink. The case panel's extra `actbillid != null &&` gate was removed because it would mask a mutation of BillLink's guard (defect family 3).
- The link text is a single text node, `Bill #N`. It has no aria-label or title, so it never matches /bills/i. Markers are untouched: case `data-testid="billed-marker"`, week "billed" span.
- No loader change: both listCaseTime and listWeek already select actbillid.

## Files Changed
- `app/bills/bill-link.tsx`: new BillLink component
- `app/cases/[id]/time-panel.tsx`: import and render BillLink after the billed marker
- `app/time/week-view.tsx`: import and render BillLink beside the "billed" span
- `tests/time/case.test.mjs:83`: guard G's exact-text literal gains " Bill #12". The row has actbillid=12, and the new link is intended behavior. It still goes red if isBilled loses its actbillid half.
- `tests/billing/time-bill-links.test.mjs`: new, 13 render and isEditable tests
- `tests/billing/time-bill-links.live.test.mjs`: new live test on case 991401

## Done-when coverage
- Case page linked/legacy/unbilled: unit tests "case panel: actbillid row keeps data-testid=billed-marker and links 'Bill #4242' → /bills/4242", "case panel: legacy billed row (actbillid null) keeps its marker and has no /bills/ link or 'Bill #' text", "case panel: unbilled row shows neither marker nor link"; live "/cases/991401 Time panel: actbillid row → marker + 'Bill #N' → /bills/N; ..."
- Week view: unit tests "week view: actbillid row keeps its 'billed' span and links 'Bill #4242' → /bills/4242", "...legacy...", "...unbilled..."; live "/time week view (staff, personid 1): ..."
- Link gated on actbillid rather than actbilled: "case panel: actbilled=false + actbillid=4243 still links", "week view: actbilled=false + actbillid=4243 still links"
- Guardrail /bills/i: "case panel journey-01 trap: link text and panel text never match /bills/i; no buttons, aria-label or title"; live asserts panel innerText has no /bills/i; case-panel.live "live A" and journey 01 pass

## Edit/delete rules (unchanged)
- Existing: tests/time/edit.test.mjs "update chain filters eq actbilled false", "update chain filters is actbillid null", "delete chain filters eq actbilled false", "delete chain filters is actbillid null", "update: any select says the row is editable but the write matches 0 rows → locked", "delete: the write matches 0 rows → locked"
- Gap: no test called isEditable directly (it gates the /time/[id] page). Added "isEditable: actbilled=false with actbillid set → not editable", "isEditable: actbilled=true with actbillid null → not editable", "isEditable: unbilled row → editable"
- Week view keeps every row's /time/<actid> date link and renders no buttons for staff: "week view: every row keeps its /time/<actid> date link; staff view renders no button and no aria-label"

## Mutation checks (each run, then restored)
- BillLink null guard dropped → legacy/unbilled row tests red in both views. Wrong href id → the 4 link tests red. Text "Bills #" → trap test red. Week BillLink removed → the 2 week link tests red.
- isEditable minus actbillid cond → only "isEditable: actbilled=false with actbillid set" red. isEditable minus actbilled cond → only "isEditable: actbilled=true with actbillid null" red.

## Deferred / Flags for Reviewer
- Hosted case 90001 started at 3.500 unbilled hours, not 2.000 (case-panel.live note): stray rows on the fixture case that predate this run. Not touched.
- package.json test script still omits tests/billing/*.test.mjs; per the Global rules the Reviewer adds it at merge.
