# Engineer Report
**Task:** lane/billing item 8 of 9 — wire BillsPanel into the case page
**Branch:** auto/billing (worktree .claude/worktrees/billing-auto, base 404724a, uncommitted — orchestrator commits)
**Date:** 2026-09-12

## Gate results
- `FOUNDATION_PG_URL=postgresql://localhost/ta_billing_gate corepack pnpm test` → tests 584, pass 507, fail 1, skip 76 (= baseline; only fail is pre-existing `advanced AND/OR/date via runSearch…`)
- `corepack pnpm exec tsx --test --test-concurrency=1 tests/billing/*.test.mjs` (dev server down) → tests 152, pass 128, fail 0, skip 24
- `corepack pnpm typecheck` → clean (tsc --noEmit, no output)
- `tests/billing/case-bills-panel.test.mjs` alone → 12/12 pass; mutation check 8/8 killed (drop case filter, billdate asc, billid asc, latest=newest-any, no admin gate, no money fmt, open≠isOpen, String(null) type)

## git diff --stat (tracked) + new files
- `app/cases/[id]/page.tsx | 3 ++-` (1 file changed, 2 insertions(+), 1 deletion(-))
- new: app/bills/bills-panel.tsx (63), lib/bills/case.ts (24), tests/billing/case-bills-panel.test.mjs (162)

## page.tsx diff
- `+import { BillsPanel } from "@/app/bills/bills-panel";` (after the TimePanel import)
- `-        <Slot title="Bills" />` → `+        <BillsPanel caseId={id} />`; Slot kept (Funds/Expenses), `await requireSession()` untouched

## Design Decisions
- Loader `listCaseBills(db, caseId)` selects only the 7 shown columns from tblbills, `.eq("billcaseid")`, order billdate desc, billid desc; never touches tblcase/numunpaidbills.
- `BillsPanel({ caseId, db?, session? })` → `session ?? await requireSession()`; admin = `role === "admin"`; failed read → "Bills could not be loaded." note.
- `BillsPanelView` is pure; open = `isOpen(billnotice)` from rules.ts; latest open = first open row in loader order (billdate desc, billid desc).
- Balance via existing `fmtMoney` (lib/bills/edit.ts); legacy null billtype renders empty cell.
- Count + notice dates in a `<dl>` (`unpaid-bill-count`, `second-notice-date`, `final-notice-date`), omitted only on a failed read; empty string when unset/no open bill.
- Copy: heading "Bills" (sole heading), columns Date/Type/Balance/Status, "Unpaid", "2nd notice", "Final notice", "No bills on this case", "New bill" — no /billed/i, no buttons/inputs.

## Files Changed
- `lib/bills/case.ts` — new case-bills loader
- `app/bills/bills-panel.tsx` — new BillsPanel + BillsPanelView
- `tests/billing/case-bills-panel.test.mjs` — 12 unit tests through real BillsPanel with fake PostgREST (applies eq/order) + injected session
- `app/cases/[id]/page.tsx` — import + Slot line swap (2 lines)

## Deferred / Out of Scope
- No dev-server/Playwright eyeball of /cases/90001 or journey 03 `450.00` — left to QA (unit test asserts 450 → "450.00").

## Flags for Reviewer
- Panel calls `requireSession()` a second time per case-page render (page discards its result; binding note forbids changing that line) — one extra profiles read.
- listCaseBills is unpaged (PostgREST max-rows 1000), marked `ponytail:`.
- Journey 03 `getByText(/billed/i)` may hit multiple time-panel matches ("Unbilled hours", "billed" marker) under Playwright strict mode — pre-existing, not from this panel.
