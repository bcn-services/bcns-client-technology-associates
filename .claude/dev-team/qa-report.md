## VERDICT: PASS
# QA Report — Item 3 Create bill (`/bills/new?case=<id>`)
**Branch:** auto/billing (worktree billing-auto, uncommitted per instructions) · **Date:** 2026-09-12 · **Gate mode:** tests+behavioral

## Criteria Checked
- DW1 timesheet 1.500+0.500 / 450.00 — unit "done-when 1: timesheet…" (hours "2.000", 1st, `Bill991100 Marlowe 2026 09 12-0`, both rows `true/880000`, unbilled "0.000") PASS; live "done-when 1 live" on case 990601 (copy of 90001, real attorney): clicked Create bill with timesheet defaults + balance 450.00 → landed /bills/<id>, DB hours 2, 1st, filename -0 with firm today, both rows claimed, reloaded form shows "Unbilled hours: 0.000" — PASS
- DW2 retainer nothing checked — unit "done-when 2" (billhours 0, zero tblactivity statements) PASS; live: selected retainer (both boxes went unchecked), saved → billhours 0, rows still `false/null` — PASS
- DW3 stale — unit "stale (i) pre-check" (0 tblbills inserts) PASS; unit "stale (ii) race" (fake flips row at the claim update → error=stale, no new bill, other row `actbilled=false, actbillid null`, 555 kept) PASS; live: after form load the row was set legacy-billed via the service role, then clicked Create bill → `?error=stale`, no bill, other row unbilled — PASS
- DW4 staff refused — unit "staff POST refused" (tblbills inserts = 0) PASS; live replay: admin control replay inserted 1 bill, staff replay of the same captured POST → `error=forbidden`, 0 tblbills rows, rows unbilled — PASS
- Guardrails: "only checked rows are updated" (unchecked row stays unbilled, unbilled 3.000) PASS; "race guard actbilled=false" (legacy-billed row, a realistic case, not re-pointed) PASS; "forged hours/total fields ignored" PASS; filename n: -0 (same case other date + other case same date), -1 (plus same-day same-case) PASS
- `actbillid is null`-only fixture: "race guard actbillid is null" PASS. Not realistic: check `tblactivity_billed_pair` (`actbillid is null or actbilled`) forbids actbilled=false with actbillid set. The legacy-billed fixture is the realistic isolator for the other guard.
- Browser (Playwright; Chrome login expired, accepted substitute): `getByText(/unbilled hours/i)` = 1, `getByLabel(/balance/i)` = 1, `getByRole('button',{name:/create bill|save/i})` = 1; timesheet default = both checked; saved with defaults → /bills/<id> — PASS

## Mutation checks (9/9 caught, each by the named assertion; restored, `cmp` clean)
claim `.is(actbillid,null)` removed → only "race guard actbillid is null" · claim `.eq(actbilled,false)` removed → only "race guard actbilled=false" · pre-check count removed → only "stale (i)" · claim count check → race tests · revert removed → race tests · delete removed → race tests · n without case filter / without date filter → filename tests · admin check removed → only "staff POST refused"

## Gate
- billing `tests/billing/*.test.mjs`: 58/58 pass, 0 skip (server up) · typecheck clean
- `pnpm test` (FOUNDATION_PG_URL gate): 584 — 548 pass / 2 fail / 34 skip (floor 507). Both failures pre-existing: search-e2e "advanced AND/OR/date", and app-shell "signed-in GET /bills (unbuilt) → 404" (stale app-shell test, not ours)
- Journey 03 (re-seeded, --workers=1): FAIL at line 18 `getByText(/unbilled hours/i)` not found. Page shows "Only admins can create bills." because `login(page,'admin')` ignores role and the only E2E account (staff@example.test) is staff. Not an item-3 defect: the global rules make create admin-only. Lane-level blocker in protected paths (tests/journeys/helpers.ts or the seeded account role): journey 03 can't pass until the E2E login is an admin.

## Tests Added
- `tests/billing/create-bill.qa.test.mjs` — 11 unit tests: real runCreateBill + real requireSession, stateful fake PostgREST with a concurrent-writer hook
- `tests/billing/create-bill.live.test.mjs` — 5 live/Playwright tests, case 990601, throwaway admin, cleanup of 990600–990699 in before/after

## Not Verifiable
none (journey 03 result reported above; blocked by the E2E account role, not by item 3)
