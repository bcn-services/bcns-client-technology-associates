# Technology Associates — billing-output lane progress

LANE.md is the contract; this tracks where we are in it — if they disagree, LANE.md wins for scope.

## Current position

- **Status:** round 1 (items 1–4, autonomous run) complete — items 1–4 done; stopped at the STOP marker.
- **Next:** item 5, Preview-then-Send (next run, after Kris and Kalpna review v1).
- **Blockers:** none. (Docs PR #18 with the MAP amendment is waiting on Nate's merge before this branch is rebased onto integration.)
- **Last updated:** 2026-09-28

## Round 1 — bill output v1

| Item | Status |
|------|--------|
| Schema and config for bill output | done — Bills can now store their priced line items and when they were finalized and sent; the email and letterhead settings exist but are optional, and the end-to-end "finalize and send a bill" test is in place and waiting for the screens. |
| Pricing engine (lines + rates) | done — The app can now work out every bill type's lines and totals the way Access did, with the 2-year rate rise, per-person rates, whole-dollar rounding, and payments credited on timesheet bills. |
| Finalize page | done — An admin can now review a bill's priced lines, change any person's rate, and finalize it; the charged rates are saved on the bill so later rate changes never alter it, and staff, closed or revised bills are refused. |
| Invoice PDF | done — Finalizing a bill now produces a PDF invoice laid out like the old Word bill, saved on the case under the legacy file name, and anyone signed in can download it from the bill page. |
| Preview-then-Send | skipped — below stop marker |
| Notice resend | skipped — below stop marker |
| Service authorization document | skipped — below stop marker |
| Wire bill output into the app | skipped — below stop marker |
