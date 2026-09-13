# Engineer Report — item 6 `/bills` list
Branch: auto/billing (worktree billing-auto), uncommitted — orchestrator commits
Date: 2026-09-12
Billing unit: 106/106 pass (11 files incl. new bills-list.test.mjs 9/9)
Billing live (dev server :3100, one file at a time): bill-page 6/6, bills-list 2/2, create-bill 5/5, notice 5/5, revise 2/2
Typecheck: exit 0
Full gate (FOUNDATION_PG_URL=ta_billing_gate, server up): 584 tests, 548 pass, 2 fail, 34 skip (floor 507 pass/1 fail)
Failure 1, known and not ours: app-shell shell.live "signed-in GET /bills (unbuilt) → 404" is stale now that app/bills/page.tsx exists (app-shell path, not edited)
Failure 2, known and pre-existing: cases search-e2e.live "advanced AND/OR/date via runSearch…"
Perf: median 543 / 545 / 604 ms over three runs (limit 1000); method = 5 authenticated GET /bills via Playwright request after 1 warm-up, against `next dev -p 3100`, 5,000 bills seeded (100 open) on cases 990700–990709; no build/start needed
Index/migration: none needed

## Design Decisions
- `lib/bills/list.ts` `loadOpenBills(db, today)`: one PostgREST query `.in("billnotice", OPEN_NOTICES)` with `tblcase(caseid)` embed, using FK tblbills_billcaseid_fkey; grouped by rank in OPEN_NOTICES, rows sorted by days desc, then billid
- Grouping has no second open filter; unknown stages rank last, so the query filter is the only guard and mutation (a) is visible
- `runBillsList({db, now, client?})` = `requireSession(undefined, client)` (any role) + `firmToday(now)`; the page calls it, and unit tests inject a staff session client and a fixed `now`
- Case number = `tblcase.caseid` from the join (tblcase has no separate number column); link to `/cases/<n>`; filename link to `/bills/<id>`, falling back to `Bill #<id>` when filename is null (legacy)
- Days, due, and last-notice come from rules.ts `daysSinceNotice` / `isDue` / `lastNoticeDate`, not re-derived

## Files Changed
- `lib/bills/list.ts` — new loader + auth-gated entry point
- `app/bills/bills-list-view.tsx` — new pure read-only view (sections per stage, `data-testid="open-bill"` rows, `due-badge`)
- `app/bills/page.tsx` — new server page; exports only default + dynamic
- `tests/billing/bills-list.test.mjs` — unit tests; the fake PostgREST applies `.in`/`.eq` and resolves the embed, and records every call
- `tests/billing/bills-list.live.test.mjs` — staff access + perf; cleans 990700–990799 at setup and in after()

## Mutation → test (tests/billing/bills-list.test.mjs unless noted); a–h spot-checked by me, each red exactly one test
- (a) drop filter → "exactly the three open ones show — every 1st, 2nd and Final bill; Paid and Cancelled absent"
- (b) swap stage order → "stage headings appear in order 1st, 2nd, Final"
- (c) ascending sort → "within 1st, the 45-day bill sorts above the 10-day bill"
- (d) days from billdate → "days since last notice: 1st 45 days, 1st 10 days, 2nd counts from its 2nd-notice date (7 days), Final 30 days"
- (e) badge always/never → "due badge on the 45-day 1st row, none on the 10-day 1st row"
- (f) per-row tblcase fetch → "one query (tblbills with tblcase embed) whether 3 or 100 bills are open — no per-row fetch"
- (g) require admin → unit "staff session (real requireSession, injected client) can load the list" + live bills-list.live "staff GET /bills → 200 and sees the open-bills list…"
- (h) write in loader/render (update or rpc) → "read-only: page entry point + render make zero writes; markup has no form/action; page exports no action"
- (i) links swapped → "links: case number → /cases/<n>, filename → /bills/<id>; row shows bill date and balance" (not mutation-run by me)

## Flags for Reviewer
- Query is unpaginated over open bills; fine at 100 open, but grows with the open count (it does not scan all bills in the app; Postgres filters on billnotice with no index)
- Seeding 5,000 bills plus the delete fires the audit-log trigger on the hosted project (about 10k audit rows per live run)
- Mutation (g) at the page level (page calling requireSession('admin') directly) is visible only to the live test; the page delegates the gate to runBillsList
