# QA Report
**Task:** Billing item 4 — Notice actions on /bills/[id]: Advance (1st→2nd→Final) and Close as (Cancelled / Carried Over / Deadbeat / Settled)
**Branch:** auto/billing (worktree billing-auto)
**Date:** 2026-09-12
**Gate mode:** tests+behavioral

## VERDICT: PASS

## Criteria Checked
- Advance 1st→2nd stamps second date = today; again → Final stamps final date, second unchanged — unit "QA advance 1st → 2nd → Final" (exact payloads + full-row literal) + live test 1 (clicked "Advance to 2nd", DB 2nd/second=NY today; set second to 2026-08-20, clicked "Advance to Final", DB Final/second 2026-08-20/final=NY today) — PASS
- Final bill shows no Advance button — unit "QA render" (button texts, content-matched) + live test 1 (after reload at Final: 0 "Advance to…" buttons, 1 "Close bill") — PASS
- Close as Cancelled on a 2nd bill leaves both dates — unit "QA close as Cancelled…" + "QA close-as payload is exactly { billnotice }" + live test 2 (selected Cancelled, clicked Close bill; whole row equal to before except billnotice; controls gone) — PASS
- Both actions refused on Paid, row unchanged — unit "QA Paid bill" (move for Paid forms, stale for replayed 1st/2nd forms, row literal-equal) + "QA every closed notice" + live tests 3–4 (captured Advance and Close-as POSTs replayed onto a Paid row → error, row equal; Paid page renders no notice section) — PASS
- Reliability: two concurrent Advance on one 1st bill → '2nd' — unit "QA concurrent" (fake serializes both at the write: [saved, stale], matched [0,1], row 2nd) + live test 3 (two simultaneous admin replays of the captured form → one saved=1, one error=stale, DB 2nd, final null) — PASS
- Reliability: 23:30 NY with TZ=UTC stamps the NY date — unit "QA TZ" (TZ set before any Date use; asserts getTimezoneOffset()===0; 03:30Z Sep 13 → 2026-09-12, 04:30Z Jan 16 → 2027-01-15, 04:30Z Sep 13 → 2026-09-13) — PASS
- Guardrail: never writes billpaiddate/'Paid'/'Partial Payment' — unit "QA no action ever writes…" (11 notices × advance + 6 targets) and "QA targets 'Paid'/'Partial Payment' refused" (zero writes); live tests assert billpaiddate null — PASS
- Guardrail: never overwrites a stamped date — unit "QA already-stamped…" (1st with second date → stale; 2nd with final date → stale; rows unchanged) — PASS
- Guardrail: closed bill never changed — unit "QA every closed notice" (Paid/Cancelled/Carried Over/Settled/Refund/Credit × both actions) — PASS
- Admin-only: staff refused for both actions — unit "QA staff" (forbidden, zero from() calls) + live tests 3–4 (staff replay of the admin's captured Advance and Close-as POSTs → error=forbidden, row unchanged) + live test 5 (staff GET: no controls) — PASS
- Duplicate submit → ?error=stale, row unchanged — unit "QA duplicate submit" + live test 3 (replayed the same captured Advance POST → error=stale, row equal) — PASS

Mutation checks 6/6 caught, each named assertion confirmed, restored with cmp: A drop `.eq('billnotice')` → QA Paid / closed-notice · B drop `.is(dateCol,null)` → QA already-stamped · C forbidden → null → QA staff · D firmToday → UTC ISO slice → QA TZ · E close-target check disabled → targets/Paid/never-writes · F close payload adds a date column → close-as payload tests.
Gate: billing 84 tests, 68 pass, 0 fail, 16 skip (no server) · `pnpm test` gate env 584 / 507 pass / 1 fail (pre-existing search-e2e "advanced AND/OR/date") / 76 skip, equal to baseline · typecheck clean · live file 5/5 against `next dev -p 3100`, run whole; server stopped; 0 leftover rows on 990800–990899, 0 throwaway admins.

## Findings (non-blocking)
- Browser QA used Playwright (headless chromium through the real dev server) instead of Claude-in-Chrome, because the Chrome login has expired. That is the accepted substitute.
- A missing bill id returns `?error=stale`, not `notfound`. This was flagged by the engineer; behavior is unchanged.
- Render emits a React warning: "Invalid value for prop `action` on <form>". It only appears under renderToStaticMarkup in unit tests. It's harmless and was also present in item 2.

## Tests Added
- `tests/billing/notice.qa.test.mjs` — 13 tests. Uses runNoticeAction + the real requireSession against an independent fake PostgREST that throws on unmodelled methods, with literal expectations.
- `tests/billing/notice.live.test.mjs` — 5 self-contained Playwright/replay tests on invented case 990801, with a throwaway admin. Cleanup runs at setup and in after().

## Not Verifiable
none
