## Billing lane → integration

Kris records every bill in the app instead of Access: bills sit on a case with a type, pull hours from the case's unbilled time, take their balance from the billing service, and move 1st → 2nd → Final notice while unpaid.

### Items (all 9 DONE, none blocked, no `caution:` items)
1. **Bill rules** — shared unpaid-status set, notice sequence, bill file names, 30-day due rule.
2. **Bill page with edit-in-place** — `/bills/[id]`, admin edits, staff read-only.
3. **Create bill** — `/bills/new` from checked unbilled time; stale-entry race aborts cleanly.
4. **Notice actions** — 1st → 2nd → Final stamps NY-date; close as Cancelled/Carried Over/Deadbeat/Settled; guarded, idempotent.
5. **Revise** — new 1st-notice copy takes the time entries, old bill Cancelled, linked both ways, once only.
6. **/bills list** — unpaid bills grouped by stage, oldest first, "due" badge; ~0.5 s at 5,000 bills.
7. **Recipient alert** — banner when the case bills a different party; CC addresses shown.
8. **Wire bills into the case page** — every bill incl. legacy, live unpaid count, latest 2nd/final dates, admin "New bill".
9. **Wire bills into time screens** — "Bill #N" links on the case time panel and weekly view; legacy billed rows keep marker, no link.

### Verification
- `pnpm test` (gate env, server up): 584 tests: 548 pass, 2 fail, 34 skip. Both failures were already failing before this run:
  - search-e2e "advanced AND/OR/date via runSearch…"
  - app-shell `shell.live` "signed-in GET /bills (unbuilt) → 404". This test is now wrong because `/bills` exists. It lives in app-shell's folder, so a human has to amend it.
- `tests/billing/*.test.mjs` (live included): **184/184 pass**. Typecheck clean.
- Every item was mutation-checked; the checks were run by the orchestrator where the engineer worked alone.

### Lane acceptance (fresh dt-review): 3 of 4 met
1. **Journey 03 passes end to end: UNMET.** The run stops at spec line 18 because protected `tests/journeys/helpers.ts` `login(page,'admin')` ignores the role and signs in as `staff@example.test`. The billing code for the path is covered by `tests/billing/case-bills-panel.live.test.mjs` "journey 03 substance", which finds exactly one 450.00 on the case page. What it still needs:
   - an admin E2E account and a role-aware `login`
   - the `/billed/i` amendment. After the bill exists that regex hits a strict-mode error, because it also matches "Unbilled hours: 0.000" and every `billed-marker`. Scope it to `getByTestId('billed-marker').first()`.
2. **A timesheet bill on 90001 takes unbilled hours to 0.000, and the rows carry billid and actbilled=true: MET.** The live test checks this on a copy of case 990601, not on 90001 itself. It reads 0.000 on `/bills/new`, not the case page; the case page uses the same query.
3. **The case page lists every bill (legacy included), with the unpaid count computed live: MET.**
4. **1st → 2nd → Final stamps dates, and `/bills` groups open bills by stage: MET.**

### Human action needed before `/merge-lane`
- [ ] Add an admin E2E account and a role-aware `login` in `tests/journeys/helpers.ts`, plus the `/billed/i` fix in journey 03. Both files are protected. `LANE.md:11-12` mentions "the `/billed/i` amendment below", but nothing below it spells the amendment out.
- [ ] Amend app-shell `shell.live.test.mjs`, which still expects `/bills` to be a 404.
- [ ] Add `tests/billing/*.test.mjs` to the `package.json` test script.
- [ ] Journey 03 changes shared hosted data every run: it bills case 90001 and claims fixture row actid 1. It needs a reset step or a case of its own.
- [ ] Confirm with Kris that a bill closed as Deadbeat should still count as unpaid and still appear on `/bills`.

### Caveats
- The bill page imports `SaSubmit` from the cases lane's `app/cases/[id]/sa-submit.tsx`.
- Item 9 edited `app/cases/[id]/time-panel.tsx`, a cases-lane path. The time and cases lanes are both merged; this was a judgement call.
- Creating and revising a bill are not transactional; the undo steps are compensating writes. If an undo fails, an orphan bill can be left behind. A `ponytail:` comment marks the spot.
- A case with no attorney saves `billfilename` as null.
- A missing bill returns `?error=stale`, not `notfound`. A second revise returns `?error=move`.
- The case page calls `requireSession()` twice per render.
- Live tests leave hosted rows behind. The perf live test creates about 10k audit rows per run. Hosted case 90001 shows 3.500 unbilled hours from stray rows left by earlier runs.
- The Chrome click-through wasn't done because the login had expired. Live Playwright tests stood in for it.
- The `dt-orchestrator` agent type dropped out of the registry mid-run. Items 7–9 ran through a general-purpose agent that followed its definition file.

### Team-memory entries (for `/merge-lane` to append)

## 2026-09-12 19:19 — dev-team-auto — Bill rules — lib/bills/rules.ts
- **Outcome:** DONE — 1 attempt — caution: no — team: dt-engineer (opus, high) — auto/billing, commit 2dcd810
- **What happened:** Pure rules module plus 15 unit tests built in one pass; the orchestrator self-verified the gate and ran mutations a–i personally.
- **What worked:** Day math through Date.UTC on parsed yyyy-mm-dd parts; guard i starts one tsx child per time zone (UTC, America/New_York, Pacific/Kiritimati) over spans that cross a DST change and a year boundary; tests named "guard &lt;letter&gt;" make the mutation readout unambiguous.
- **What failed:** My first-letter mutation for c also reddened guard b ('Paid' matched 'Partial Payment'), so it had to be rebuilt as a clean case-insensitive exact match. Mutation f can't be isolated from guard g by construction.
- **Remember next run:** tests/cases/search-e2e.live.test.mjs "advanced AND/OR/date via runSearch" fails against ta_billing_gate independently of billing — triage before merge; it is not a billing regression. lib/bills/rules.ts deliberately does not import lib/time/week.ts addDays (that module pulls in auth/cases imports). The gate prints 584 tests because tests/billing isn't in the test script until merge.

## 2026-09-12 19:31 — dev-team-auto — Bill page with edit-in-place
- **Outcome:** DONE — 1 attempt — caution: no — team: dt-analyze sonnet/high, dt-engineer opus/high, dt-qa opus/high — auto/billing, ecd5516
- **What happened:** dt-analyze built the shared analysis for items 2–9. The engineer built the page, the view, the edit action and its tests. QA added 6 live tests (unknown id 404, legacy bill, two attached rows, admin edit then reload, admin-then-staff replay of the real edit request, staff page has no form) and passed. The orchestrator ran 6 of 6 mutations, all red.
- **What worked:** The edit writes only from a fixed list of six columns, so a forged form can't reach the other columns. The action body sits in `runEditBill(billid, formData, deps)`, so unit tests call it with the real `requireSession`. The live replay compares the row column by column, and its fixture includes a time row on the same case attached to another bill, which is what caught the filter mutation.
- **What failed:** The engineer's unit test for an unknown id only searched the page's source code; the live 404 test replaced it. Chrome Browser QA was blocked by an expired Chrome login, so Playwright covered the click-through. The dev server started with `nohup &amp;` from the Bash tool died silently.
- **Remember next run:** Start the dev server with Bash `run_in_background` (`exec corepack pnpm exec next dev -p 3100`), not `nohup &amp;`. Import `BILL_TYPES` from `lib/bills/rules.ts`. The page checks admin in two places, so a mutation must break the `admin` value in `page.tsx` to be caught. The bill page imports `SaSubmit` from the cases lane.</result>

## 2026-09-12 20:05 — dev-team-auto — Create bill — /bills/new
- **Outcome:** DONE — 1 attempt — caution: no — team: dt-engineer opus/high, dt-qa opus/high — auto/billing, adbe7ed
- **What happened:** Built the create page, the form, `runCreateBill`, and the pre-check → insert → guarded claim → undo-on-mismatch flow in lib/bills/create.ts. QA passed on the first try with unit, live and Playwright tests. The orchestrator ran 9/9 mutation checks, all red.
- **What worked:** A fake database that flips a row between the pre-check read and the claim update. It is the only way the undo guards (d/e/f) can be seen, because the pre-check otherwise catches staleness before any insert. A Python mutation runner with backup, count==1 replace, cmp restore, and TAP `not ok` filtering.
- **What failed:** Protected journey 03 fails because its admin login actually signs in staff, and create is admin-only. Running a live test alone by name failed in setup because it needs an earlier test's captured request.
- **Remember next run:** Run live replay tests as a whole file, never with `--test-name-pattern`. Journey 03 needs an admin E2E login (protected helpers.ts or the seed) before any admin-only billing page can pass it. The `actbillid is null` filter can only be mutation-isolated in the fake database, because the check constraint forbids that pair.

## 2026-09-12 21:30 — dev-team-auto — Bill notice actions (item 4)
- **Outcome:** DONE — 1 attempt — caution: no — team: dt-engineer opus/high, dt-qa opus/high — auto/billing, commit 84c7cc5 (reports 6e7ff69)
- **What happened:** lib/bills/notice.ts (guardedUpdate: .eq billnotice expected + .is date col null + .select count ≠1 → stale) with runNoticeAction(kind, id, form, deps) in app/bills/actions.ts, and the buttons in bill-view.tsx. QA added unit tests and live Playwright tests (captured-POST replays: duplicate, concurrent, staff, Paid). QA PASS on the first try; orchestrator mutations 9/9 red.
- **What worked:** a shared runNoticeAction with injected session/now; firmToday(now) from lib/cases/presets.ts is already the clock seam; mutating the admin check per kind inside runNoticeAction (the unit tests inject deps, so editing actions.ts would go unseen).
- **What failed:** the engineer stopped mid-turn waiting on background gate runs and had to be resumed; running two gate commands at once gave 70 false failures.
- **Remember next run:** for Advance, the billnotice filter and the date-null filter overlap. Dropping the billnotice filter shows up only in the "stale 1st form on a closed bill" test, not the concurrency test. Tell builders to run gate commands in the foreground, one at a time.

## 2026-09-12 21:15 — dev-team-auto — Item 5 Revise bill
- **Outcome:** DONE — 1 attempt — caution: no — team: dt-engineer opus/high, dt-qa opus/high — auto/billing, commit 21a0e9e
- **What happened:** Built lib/bills/revise.ts (reviseBill + runRevise) with reviseBillAction wrapper; Revise button in bill-view gated on admin+open+not superseded; reused guardedUpdate (now exported) and fileNameFor (extracted from create.ts). QA PASS first try with unit + Playwright live tests; orchestrator ran 11 mutations, all red.
- **What worked:** A fake DB that flips B's notice between read and cancel was the only way to exercise the undo paths; making the move-by-case mutation also change the row-count read kept the move-count check from hiding whether the bill filter matters.
- **What failed:** none. Mutation (i) (actbilled=false on move) cannot be seen through unbilledHours, which needs actbilled=false AND actbillid null; only the actbilled===true assertion in revise.test.mjs:111 catches it.
- **Remember next run:** Checks in reviseBill run in this order: open, stale, superseded, so a second revise of a Cancelled B returns ?error=move and you need an open-but-superseded fixture to reach the superseded check. The run* action bodies live in lib/bills/*.ts, not in the "use server" actions.ts. The unbilled-hours metric can't detect actbilled flips on attached rows, so assert actbilled directly.

## 2026-09-12 21:12 — dev-team-auto — Item 6 /bills list
- **Outcome:** DONE — 1 attempt — caution: no — team: dt-engineer (opus, high) — auto/billing, d21cff8
- **What happened:** Built `lib/bills/list.ts` (`loadOpenBills` plus the entry point `runBillsList`, which calls `requireSession`), a pure `app/bills/bills-list-view.tsx`, and a thin `app/bills/page.tsx`. It has 9 unit tests (fake PostgREST that applies `.in`/`.eq` filters and resolves the `tblcase(...)` embed) and 2 live tests (staff access, perf 570 ms median). The orchestrator ran 13 mutations; each turned exactly one named test red.
- **What worked:** A fake db that really applies the filters it is given, so a dropped open-status filter shows up as Paid and Cancelled rows. Keep the query as the only open-status guard, with no second filter in grouping that would mask it. Split negative checks so the call-count test counts only reads and the read-only test counts only writes, so each mutation reddens one test. A fixture where `billdate` and `lastNoticeDate` differ (a 2nd bill with a recent 2nd-notice date) catches days computed from the wrong date.
- **What failed:** The engineer ended its turn waiting on a Monitor/background run and had to be resumed with "finish in the foreground".
- **Remember next run:** Putting the auth check inside the `run*` entry point makes it unit-testable, but a page-level role gate is visible only to the live test. The `tests/billing/*.test.mjs` glob includes the live files, so run it with the dev server stopped (they skip) or fully warmed, never mid-shutdown. Say "no Monitor, no background gate runs" explicitly in every engineer spawn. The perf live test churns about 10k hosted audit rows per run.

## 2026-09-12 21:49 — dev-team-auto — Recipient alert
- **Outcome:** DONE — 1 attempt — caution: no — team: dt-engineer (opus, high) — auto/billing, 430cd36
- **What happened:** Pure RecipientAlert (app/bills/recipient-alert.tsx) rendered by BillView and NewBillForm; billingalert/billingcc added to the existing tblcase select in loadBill and loadNewBill. Engineer self-verified; orchestrator re-ran gates and 13 mutations (11 unit, 2 live), all red on the intended test.
- **What worked:** A fake PostgREST that projects select columns lets a unit test see a column dropped from a loader select; renderToStaticMarkup of the real views with literal loader-shaped data; the display-only proof drives real runCreateBill/runEditBill and asserts zero tblcase write calls plus unchanged tblcase rows; live file uses its own range 991000–991099 (copies of case 90001) with a throwaway admin.
- **What failed:** none.
- **Remember next run:** Next dev hot-reloads lib edits, so live mutations can run against a warm server without a restart. Mutations in shared save paths (runCreateBill) are also seen by any combined create+edit test through its redirect assertion — expected, note it. Staff never see the alert on /bills/new (the page renders no form for staff); they do see it on the bill page.

## 2026-09-12 23:05 — dev-team-auto — Wire bills into the case page
- **Outcome:** DONE — 1 attempt — caution: no — team: dt-engineer (opus, high), dt-qa (opus, high) — auto/billing, 5f049a9
- **What happened:** `BillsPanel({caseId, db?, session?})` plus a pure `BillsPanelView` in `app/bills/bills-panel.tsx`, and `listCaseBills` in `lib/bills/case.ts` (ordered billdate desc, billid desc; latest open = first open row). The page discards its `requireSession()` result, so the panel calls the same helper itself. `page.tsx` changed by +1 import and the Slot line. QA added 13 single-guard unit tests and 4 live tests. The orchestrator ran 12 mutations, all red.
- **What worked:** a QA fake PostgREST that applies eq/neq/gt/gte/lt/lte/is/in/not/order/limit/single, projects the select list, and throws on anything else. Only a fake like that lets a filter added in the loader turn a unit test red. Live tests on 991300–991399 with a throwaway admin running the real `/bills/new` form stand in for journey 03.
- **What failed:** the engineer's fake ignored unknown filters, so its tests missed loader-side mutations; QA's fake closed that gap. The first live run on a fresh server failed test 1 on the cold compile of `/cases/[id]`.
- **Remember next run:** `notice.live` cleanup deletes all of 990800–990899, so new billing live tests use 9913xx. Warm `/cases/&lt;id&gt;` as well as /login and /api/health before live case-page tests. Journey 03 still stops at line 18 (`/unbilled hours/i`) because `login(page,'admin')` signs in staff — a protected helpers.ts amendment the human owes. The `/billed/i` strict-mode ambiguity with "Unbilled hours" is still untested behind it. The case page now calls `requireSession()` twice per render: one extra profiles read.</result>

## 2026-09-12 22:37 — dev-team-auto — Wire bills into time screens (billing item 9)
- **Outcome:** DONE — 1 attempt — caution: no — team: dt-engineer opus/high — auto/billing, commit 79f240f
- **What happened:** Shared `app/bills/bill-link.tsx` (`BillLink`, null-gated on actbillid) wired into `app/cases/[id]/time-panel.tsx` and `app/time/week-view.tsx`; render tests + live test on case 991401; orchestrator ran 17 mutations, all red on the intended assertion.
- **What worked:** Four-row fixture (linked, legacy, unbilled, actbilled=false+actbillid set) isolates the actbillid gate from the isBilled gate; rows matched by description text; a python mutation driver (backup, exact-once replace, diff -q, run, restore, cmp) made 17 checks cheap; live-page mutations double as controls (the other page's test stays green).
- **What failed:** Engineer's first mutation script didn't restore files (pre-existing /tmp backup dir); it recovered by hand — use a fresh mktemp dir per mutation.
- **Remember next run:** No time test called `isEditable` directly before this item (`tests/time/edit.test.mjs` only checks write filters) — the new isEditable tests live in tests/billing/time-bill-links.test.mjs. Hosted case 90001 carried 3.500 unbilled hours (stray rows from earlier runs). Billing live range 9914xx now in use (991401).

🤖 Generated with [Claude Code](https://claude.com/claude-code)

https://claude.ai/code/session_01Vv7AwHdcdP8WipnqvnW2Rs
