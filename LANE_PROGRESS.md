# Technology Associates — billing-output lane progress

LANE.md is the contract; this tracks where we are in it — if they disagree, LANE.md wins for scope.

## Current position

- **Status:** round 2 (items 5–8, autonomous run) in progress — items 1–7 done.
- **Next:** item 8, wire bill output into the app.
- **Blockers:** none.
- **Last updated:** 2026-09-30

## Rounds 1–2 — bill output v1

| Item | Status |
|------|--------|
| Schema and config for bill output | done — Bills can now store their priced line items and when they were finalized and sent; the email and letterhead settings exist but are optional, and the end-to-end "finalize and send a bill" test is in place and waiting for the screens. |
| Pricing engine (lines + rates) | done — The app can now work out every bill type's lines and totals the way Access did, with the 2-year rate rise, per-person rates, whole-dollar rounding, and payments credited on timesheet bills. |
| Finalize page | done — An admin can now review a bill's priced lines, change any person's rate, and finalize it; the charged rates are saved on the bill so later rate changes never alter it, and staff, closed or revised bills are refused. |
| Invoice PDF | done — Finalizing a bill now produces a PDF invoice laid out like the old Word bill, saved on the case under the legacy file name, and anyone signed in can download it from the bill page. |
| Preview-then-Send | done (2026-09-30) — An admin can now preview a finalized bill's email (To, CC, subject, message, PDF attached), edit it, and send it; the bill records when and to whom, a double click sends once, and with no email settings the preview still works and Send is greyed out with a plain message. |
| Notice resend | done (2026-09-30) — An admin can now email a 2nd or Final notice: the stored invoice goes out with the red notice stamp on page 1, the original file is never changed, the notice dates stay as they were, a double click sends once, and with no email settings the stamped preview still works. |
| Service authorization document | done (2026-09-30) — Anyone signed in can now press Create SA on a case to get the service authorization PDF (case, attorney, firm, rate, and the case's unbilled work), saved on the case with a new Awaiting Approval row; the approval date now follows the old Access rule. |
| Wire bill output into the app | skipped — below stop marker |
