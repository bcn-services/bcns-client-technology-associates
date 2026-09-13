## VERDICT: PASS
**Branch:** auto/billing (worktree .claude/worktrees/billing-auto, uncommitted on 404724a) · **Date:** 2026-09-12 · **Gate mode:** tests+behavioral

## Criteria Checked
- Case page renders BillsPanel; 3 bills incl. legacy (null type, 0 hrs, Paid) newest first with balance/status/`/bills/<id>` link: live `(l) /cases/991351 renders the Bills panel…` (rows exactly `2026-09-01 timesheet 1234.50 Deadbeat` / `2026-08-01 retainer 123.45 1st` / `2019-03-04 75.50 Paid`, hrefs = seeded billids): PASS.
- 1st + Deadbeat + Paid, `numunpaidbills` = 5 → `unpaid-bill-count` 2: live `1st + Deadbeat + Paid with tblcase.numunpaidbills = 5 → …` (checks the DB row is 5, count shows "2", notice dates 2026-07-01 / 2026-08-01): PASS.
- Bill created via `/bills/new` → balance on the case page: live `journey 03 substance…` (throwaway admin filled 450.00 on the real form for 991352, got redirected to /bills/<id>, `450.00` is visible inside bills-panel and `getByText(/450\.00/)` matches once on the page): PASS. I tested against this substitute; journey 03 itself is blocked (see below).
- Staff sees the panel without "New bill": live `staff sees the panel…` (3 rows, 0 `New bill` links, 0 `a[href^="/bills/new"]`; admin href = `/bills/new?case=991351`): PASS.
- Guardrails: the page.tsx diff is exactly the import line plus `<Slot title="Bills" />`→`<BillsPanel caseId={id} />`. No `/billed/i` in panel markup (QA(i), plus live panel innerText). Heading "Bills" (QA(j), journey 01 green). PASS.

## Mutation → test (tests/billing/case-bills-panel.qa.test.mjs; exactly 1 QA test red for each, verified by applying and restoring)
- (a) count from tblcase.numunpaidbills → `QA(a)` · (b) count uses bills.length → `QA(b)` · (c) count excludes Deadbeat → `QA(c)`
- (d) billdate asc → `QA(d)` · (e) view `filter(b.billtype)` / loader `.not("billtype","is",null)` / loader `.gt("billhours",0)` → `QA(e)` (all 3 variants)
- (f) staff gets New bill → `QA(f)` · (g) latest = bills[0] → `QA(g)` · (h) `?? "—"` and `String(null)` → `QA(h)` · (i) "Billed" column → `QA(i)`
- (j) heading "Invoices" → `QA(j)` · (k) row href → `/cases/<id>` → `QA(k)` · tie (billid asc) → `QA(tie)`
- (l) page.tsx back to `<Slot title="Bills" />` (live, hot-reloaded) → `(l) /cases/991351 renders the Bills panel…` red. All 4 live tests go red because every behavior depends on the panel being wired. Restored, and the diff was re-checked.
- Engineer's file doesn't catch e2/e3: its fake ignores unknown filters. My QA fake applies them or throws on them.

## Gates
- `pnpm test` (server down): 584 tests / 507 pass / 1 fail / 76 skip = floor; the only fail is the known `advanced AND/OR/date via runSearch…`. I didn't run it with the server up, so the stale shell.live /bills 404 test wasn't exercised.
- `tests/billing/*.test.mjs`: server down 169 / 141 pass / 0 fail / 28 skip; warmed 169 / 169 pass / 0 fail / 0 skip. The 5,000-bill perf test ran once.
- `pnpm typecheck`: exit 0, clean.
- Journey 01 (`--workers=1`, after seed-e2e): 1 passed.
- Journey 03: stops at `03-time-to-bill.spec.ts:18` `expect(getByText(/unbilled hours/i)).toBeVisible()`, "element(s) not found". The page shows `New bill` + "Only admins can create bills." because `login(page,'admin')` signs in staff (known protected-helper blocker). It never reached the 450.00 or /billed/i steps.

## Browser QA
- I used a Playwright click-through as the substitute (Chrome login expired). On `/cases/991361` as admin: the aria snapshot shows heading "Bills", a Date/Type/Balance/Status table in the right order, Unpaid 2, 2nd notice 2026-07-01, Final notice 2026-08-01. Clicking row 2026-09-01 opened `/bills/<id>`, and clicking New bill opened `/bills/new?case=991361`. No console errors.
- Staff: same panel, 0 New bill links, and the row link opens `/bills/<id>`. No console errors.

## Tests Added (uncommitted, per orchestrator)
- `tests/billing/case-bills-panel.qa.test.mjs` — 13 single-guard unit tests through the real BillsPanel/listCaseBills. The fake PostgREST applies eq/neq/gt/gte/lt/lte/is/in/not/order/limit and single, projects the select list, and throws on any other method.
- `tests/billing/case-bills-panel.live.test.mjs` — 4 live tests on cases 991351/991352. I used 991300–991399 instead of 9908xx because notice.live's cleanup deletes all of 990800–990899.

## Cleanup
- No rows left in 991300–991399 (tblcase/tblbills/tblactivity), no throwaway admins left, click-through case 991361 removed. Server stopped, port 3100 free.
- Deleted the row journey 03 created (actid 12: 90001 / 'Reviewed file' / 1.5). Actid 5 'Reviewed file' was already there from an earlier run, so I left it untouched. Case 90001 now has activity rows 1, 2, 5 and bill 1.

## Not Verifiable
- Journey 03 as written can't reach its 450.00 assertion (protected helpers.ts blocker). The live `journey 03 substance` test covers the same flow.
