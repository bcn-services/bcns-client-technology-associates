# Engineer Report
**Task:** Link a check to the bill it paid — review fixes (attempt #2)
**Branch:** auto/money
**Date:** 2026-09-15

## Design Decisions
- pay.ts: undo the link only on a definite loss of the bill write (no error, 0 rows → "stale"); an erroring bill write may have committed, so the link is kept and the action returns "failed". Residual is only a link on an unchanged bill, never a Paid bill without its link.
- pay.ts: link write also guards `fndscaseid = caseId`, so a case move between read and link refuses ("linked").
- save.ts: edit refuses a case change on a linked row (`linkedcase`, surfaced via the existing `?error=` key). Pre-read of the row, plus `.is("fndsbillid", null)` on the update when the case moves, so a pay that links the row meanwhile wins the race.
- reverse.ts: the reversal-vs-pay race is documented as a `ponytail:` residual (display-only), not patched.

## Files Changed
- `lib/funds/pay.ts` — keep the link on a bill-write error; add the fndscaseid guard on the link write; header updated.
- `lib/funds/save.ts` — `linkedcase` refusal + message; guarded update when the case moves.
- `lib/funds/reverse.ts` — ponytail residual comment for the reversal race.
- `tests/money/bill-link.test.mjs` — QA error test rewritten (link kept, no undo write); new tests: bill update applies then errors (link stays, bill Paid, failed); case-moved decoy for the link write; edit case-change refusal (linked refused, unlinked moves, linked-meanwhile loses). Lost-race undo test kept.
- `tests/money/funds.test.mjs` — the "zero rows → notfound" local fake now answers the new pre-read with a real row (it used to return an array to maybeSingle).

## Verification
- Mutations (pay.ts backed up and restored, cmp identical): M1 undo on bill-write error → the 2 new ambiguous-error tests go red; M2 fndscaseid guard dropped → the case-moved decoy test goes red.
- Cold unit (BASE_URL=:3999): 611 pass / 1 fail / 156 skip. The fail is the known "26 FKs" test (amendment-caused, protected).
- tests/money cold: 159/0/59. Warm on :3100: 218/0/0.
- tsc --noEmit clean. Journeys 01–05 after seed-e2e: 5 passed.

## Deferred / Out of Scope
- Guarded post-insert patch for the reversal race (minor, display-only). Upgrade condition is in the reverse.ts comment.

## Flags for Reviewer
- save.ts: edit now does one extra read (loadFunds) per save.
- save.ts: an edit that keeps the same case doesn't guard on fndsbillid, by design; edit never writes fndsbillid.
