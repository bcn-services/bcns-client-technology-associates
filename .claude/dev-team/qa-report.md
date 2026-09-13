# QA Report
**Task:** Item 5 — Revise an open, not-yet-superseded bill on /bills/[id] (lib/bills/revise.ts)
**Branch:** auto/billing (worktree billing-auto), uncommitted per orchestrator
**Date:** 2026-09-12
**Gate mode:** tests+behavioral

## VERDICT: PASS

## Criteria Checked
- Revise B with two rows gives B′ with the same type/hours/balance and '1st', both rows on B′, B 'Cancelled' with all other fields unchanged. Unit: `qa: revise B with two rows …` compares every column of B. Live: admin clicked Revise and was redirected to /bills/<B′>. DB: B′ has timesheet/3.25/812.5/'1st'/supersedes B, rows a1 and a2 point to B′, and B deepEquals its before-state except billnotice='Cancelled'. PASS
- "Revised by #B′" and "Revises #B" links. Unit: `qa render: 'Revised by #B′' …` (checks hrefs). Live: on B′ the "Revises #B" link has href /bills/B; clicked it and landed on /bills/B, where the "Revised by #B′" link has href /bills/B′ and there is no Revise button. PASS
- Second revise refused, no bill inserted. Unit: `qa: revising B a second time …` (with the stale '2nd' form and with 'Cancelled'; bill count stays 3). Live: replaying the captured admin Revise POST gives ?error=, case bill count unchanged, row still on B′, B unchanged. PASS
- Case unbilled hours are the same before and after. Unit: `qa: case unbilled hours equal …` ("0.750" both times, via real listCaseTime/unbilledHours). Live: same check through the service-role db, "0.750" both times. PASS
- Guardrail: B is never deleted and only billnotice is written. Unit: `qa: B is never deleted and the only column written to B …` (the only tblbills update/delete is {billnotice:'Cancelled'}), plus the full-row compare in unit and live. PASS
- Guardrail: rows move only from B to B′. Unit: `qa: another bill's rows on the same case are untouched`. Live: row a3 on the other bill still points to that bill. PASS
- Extra checks, all PASS: staff refused (unit, and a live staff replay while B was made revisable again, with an admin control replay that succeeded); already-superseded open B refused with ?error=revised; closed B refused; a stale status change before the cancel is compensated; concurrent revises leave exactly one B′; the Revise button renders only for admin + open + unsuperseded.
- Browser QA: Chrome login expired, so Playwright (chromium, throwaway admin) was the accepted substitute. The dev server was started on :3100, warmed, and stopped.

## Tests Added
- `tests/billing/revise.qa.test.mjs`, 17 tests, driving the real runRevise + requireSession against a stateful fake PostgREST:
  - qa: revise B with two rows → B′ has B's type/hours/balance and '1st', rows on B′, B Cancelled with every other column unchanged
  - qa: B is never deleted and the only column written to B is billnotice
  - qa: case unbilled hours equal before and after the revise
  - qa: another bill's rows on the same case are untouched by a revise
  - qa: revising B a second time is refused and inserts no bill
  - qa: staff session refused (forbidden), nothing inserted
  - qa: already-superseded OPEN B refused with ?error=revised, no insert
  - qa: closed B (Settled) refused, no insert
  - qa: stale status flip before cancel → ?error=stale
  - qa: stale status flip before cancel → rows rolled back onto B
  - qa: stale status flip before cancel → no orphan B′
  - qa: two concurrent revises of the same B → exactly one B′, rows on it, no orphan
  - qa render: Revise button present for admin on open unsuperseded bill / no Revise button on a superseded bill / on a closed bill / for staff
  - qa render: 'Revised by #B′' links to /bills/B′ and 'Revises #B' links to /bills/B
- `tests/billing/revise.live.test.mjs`, 2 tests. Case 990901, range 990900–990999 cleaned at setup and in after() (supersedesbillid is nulled before the delete because of the FK). Each test sets up its own data.
  - click Revise: redirect to /bills/<B′>, B′ copies B, rows moved, other bill's row untouched, B only Cancelled, links both ways, unbilled hours unchanged
  - captured Revise POST replayed: second revise refused, no bill inserted, rows stay on B′; staff sees no Revise and staff replay is refused

## Gate
- billing: 115 tests, 97 pass, 0 fail, 18 skip (no server). Live file as a whole with the server up: 2/2 pass. Typecheck clean.
- full suite: 584 tests, 507 pass, 1 fail, 76 skip. Matches the baseline. The 1 failure is the pre-existing search-e2e test by count; the failure name was not re-read.
- QA spot mutations 5/5 red, restored with cmp: superseded check → test 7 only; undo in the cancel catch → tests 10 and 11; cancel unguarded → tests 9–11; admin check → test 6 only; move filtered by case instead of bill → 8 tests (not isolated).

## Findings
- LOW — lib/bills/revise.ts:25 — the superseded check is a pre-read, so it doesn't close the race by itself. The concurrency test shows the move count and the cancel guard cover it. No fix needed.
- INFO — the second-revise refusal comes back as ?error=move (the isOpen check fires first) and not ?error=revised. That's fine for the criterion; the revised branch is proven separately on an open B.

## Not Verifiable
none
