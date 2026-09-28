# Technology Associates — billing-output lane progress

LANE.md is the contract; this tracks where we are in it — if they disagree, LANE.md wins for scope.

## Current position

- **Status:** round 1 (items 1–4, autonomous run) in progress — item 1 done.
- **Next:** item 2, the pricing engine.
- **Blockers:** none. (Docs PR #18 with the MAP amendment is waiting on Nate's merge before this branch is rebased onto integration.)
- **Last updated:** 2026-09-28

## Round 1 — bill output v1

| Item | Status |
|------|--------|
| Schema and config for bill output | done — Bills can now store their priced line items and when they were finalized and sent; the email and letterhead settings exist but are optional, and the end-to-end "finalize and send a bill" test is in place and waiting for the screens. |
| Pricing engine (lines + rates) | not started |
| Finalize page | not started |
| Invoice PDF | not started |
| Preview-then-Send | skipped — below stop marker |
| Notice resend | skipped — below stop marker |
| Service authorization document | skipped — below stop marker |
| Wire bill output into the app | skipped — below stop marker |
