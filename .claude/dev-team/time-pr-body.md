## Time lane — in-app time entry replacing the NAS Excel timesheets

Staff log hours per case in the app (typed or with a start/stop timer), correct them in a week view, and every case page shows its unbilled hours. Built unattended by `/dev-team-auto` from `LANE.md`; 6/6 items done, 0 blocked, no `caution:` items (each item mutation-checked by its orchestrator).

### Items
| # | Item | Commit |
|---|------|--------|
| 1 | `/time` entry form + insert (`actwho` from session, billing columns never written) | 7daa3f3 |
| 2 | Week view (Mon–Sun, firm-local) + admin unbilled-by-case | dcf862a |
| 3 | `/time/[id]` edit/delete — billed / other-person rows refused in the write filter | c1fcf1c |
| 4 | Start/stop timer (localStorage `ta.timer`, 0.125 h rounding, survives reload) | 1e92612 |
| 5 | Time panel on `/cases/[id]` (rows, billed markers, Unbilled hours) — wiring, cases | 0eda1d5 |
| 6 | Header running-timer indicator + staff E2E seed at `personid 1` — wiring, app-shell | def5569 |

Wiring edits outside owned paths: `app/cases/[id]/page.tsx` (+2), `app/cases/[id]/time-panel.tsx` (new, named by item 5), `app/layout.tsx` (1 import + 1 child), `tests/app-shell/seed-e2e.ts` + `seed-e2e.check.ts` (staff-only `seedStaffE2e`; `seedE2eUser` default stays `personid: null`). `MAP.md`/`MAP_PROGRESS.md` changes are the lane-plan amendment (`950fc6a`).

### Lane acceptance (fresh dt-review, read-only)
- (a) Journey 03 through `/time`, row `actwho` = login's person, unbilled — **MET** (journey run: passes through "Entry added", fails at `/bills/new` — billing's)
- (b) Timer → rounded 0.125 h entry, shown under today, editable — **MET in code**; tested piecewise, not one end-to-end chain
- (c) `/cases/90001` Time section, both fixture rows, Unbilled hours 2.000 — **MET in code**; live test checks format only, unit tests prove 2.000
- (d) Billed rows refused on every time screen, row unchanged — **MET**; filter lives in the UPDATE/DELETE statement, proven by live replay with forged ids
- Global rules all met; no HIGH findings.

### Regression run (auto/time @ def5569, server on 3100, `BASE_URL` set)
- `tsc --noEmit` clean
- `pnpm test`: 425 → 422 pass / 2 fail / 1 skip — both failures pre-existing (`signed-in GET /bills (unbuilt) → 404`, `advanced AND/OR/date via runSearch…`)
- `tests/time/*.test.mjs`: 159/159 (not yet in `pnpm test`)
- Journeys (`--workers=1`): 01 pass · 02 fail pre-existing (`02-inquiry-to-case.spec.ts:25` strict `getByText(/firm/i)` → header "Firms" link + case "Firm" heading) · 03 passes `/time`, fails at `/bills/new` (billing)

### For the reviewer at merge
- Add `tests/time/*.test.mjs` to the `test` script in `package.json`.
- `tests/cases/shell-wiring.test.mjs:70`, `tests/cases/inquiries.live.test.mjs:113`, `tests/app-shell/users.live.test.mjs:40`, `tests/app-shell/shell.live.test.mjs:33` re-seed the staff login with `personid: null` — run `tests/app-shell/seed-e2e.ts` after `pnpm test` before journey 03, or switch those calls to `seedStaffE2e`.
- Journey 02 `/firm/i` ambiguity needs a journey amendment or nav change; journey 03's closing `getByText(/billed/i)` will need scoping for the billing lane.
- Minor follow-ups from review: assert 2.000 in `case-panel.live` (clear leftover rows on 90001 first); Hours input is `step=0.001` rather than the spec'd 0.125; admin Person picker fails silently; `listCaseTime` unpaged (1000-row cap, marked `ponytail:`).

### Team-memory entries (lane mode — for the reviewer to append to `.claude/dev-team/team-memory.md` on merge)

## 2026-09-12 13:27 — dev-team-auto — lane/time item 1: Time entry form and insert
- **Outcome:** DONE — 1 attempt — caution: no — team: dt-analyze sonnet/high, dt-engineer opus/medium — auto/time, 7daa3f3
- **What happened:** Built the /time server-rendered form, the addEntry action, and insertEntry (lib/time/entries.ts) with 28 fake-PostgREST unit tests and a 4-case live test. Engineer passed on attempt 1; the orchestrator ran mutation checks (a)–(h) in place of QA, and all went RED.
- **What worked:** One named test per guard, each asserting the error code plus zero inserts, so each mutation killed exactly its own assertion. Sending acthrs as the typed string guarantees no rounding. The live personId-null check captures a real addEntry POST, replays it once while linked as a control (it must insert), then unlinks and replays.
- **What failed:** The orchestrator narrowed the live test's count and cleanup to actwho = PERSON. That hid the null-actwho row a broken personId-null refusal inserts: mutation (g2) survived, and the leaked row (actid 7) had to be deleted by hand. Fixed by filtering `actwho.eq.1,actwho.is.null`.
- **Remember next run:** A live test's "inserted nothing" count must include the row the bug would write — for actwho that means actwho IS NULL — or the negative assertion goes vacuous and the row leaks past cleanup. requireSession() can't run under tsx, so the personId-null refusal sits in both addEntry and insertEntry; only the live replay proves the action's own check. With a server up, app-shell's `signed-in GET /bills (unbuilt) → 404` fails; it is the same stale-404 kind as the /cases check.

## 2026-09-12 14:10 — dev-team-auto — Week view + admin unbilled-by-case
- **Outcome:** DONE — 1 attempt — caution: no — team: dt-engineer opus/medium — auto/time-item2, dcf862a
- **What happened:** Built /time week view (week-view.tsx server component, lib/time/week.ts pure helpers + listWeek, lib/time/unbilled.ts) with a 2-line page.tsx change for merge-friendliness with parallel item 3. Engineer self-verified; orchestrator re-ran mutations (a)–(j), gate, and 3-TZ runs.
- **What worked:** Pulling every rule into a pure lib helper (resolveWho, weekBounds, groupByDay, isBilled) plus an injectable-db async server component rendered with renderToStaticMarkup — page behaviour tested with no dev server or auth. One "guard <x>" test per safety rule made each mutation name its own assertion. TZ test spawns tsx child processes under UTC/NY/Pacific/Kiritimati.
- **What failed:** none. Optional live test skipped: only one E2E login exists (staff) and a parallel item was toggling its personid.
- **Remember next run:** Hours sums go through integer thousandths (thousandths/fmtHours in lib/time/week.ts); date math via Date.UTC + getUTCDay on the string (addDays). zsh treats a bare `=====` echo as a command expansion — don't use it as a separator. No admin E2E login exists in .env.local; admin-only UI is only provable by render tests unless one is added.

## 2026-09-12 14:40 — dev-team-auto — Edit and delete at /time/[id]
- **Outcome:** DONE — 1 attempt — caution: no — team: dt-engineer opus/medium — auto/time-item3, c1fcf1c
- **What happened:** Built /time/[id] (editable form with Save + separate Delete form; billed rows read-only; staff get "Not found" on others' rows) and updateEntry/deleteEntry in lib + actions. Shared `editableOnly()` puts the actid + unbilled + staff-actwho filters on the write statement itself; `.select()` on the write detects zero rows → locked. Orchestrator ran 20 unit + 2 live mutations, all red.
- **What worked:** A fake PostgREST proxy recording each chain separately, one test per filter per chain, so each mutation reds exactly one named test. Mutations built by replacing the shared-helper call site with an inline chain, isolating update from delete. Live refusal tests re-read the full row by actid and compare every column.
- **What failed:** In the engineer's server-up gate, two cases-lane live tests flaked under shared-hosted load; passed alone. No wasted attempts.
- **Remember next run:** Hosted fixture row 2 is actbilled=true, actbillid=null → renders "Billed". Never mutation-check the billed filter live — it would rewrite hosted row 2. The action's personId-null check is only proven by a source-reading test unless a live replay runs with an unlinked login. entry-form.tsx Hours step is now 0.001; later form changes must keep 3-decimal legacy values submittable.

## 2026-09-12 14:28 — dev-team-auto — Start/stop timer on /time
- **Outcome:** DONE — 1 attempt — caution: no — team: dt-engineer (opus, medium) — auto/time, 1e92612
- **What happened:** Pure timer logic in lib/time/timer.ts (integer-eighths rounding, injected clock) + client app/time/timer.tsx that fills EntryForm's own fields by id; ta.timer keeps `stoppedAt` after Stop until the ?added=1 render or Discard. Engineer self-verified; orchestrator ran 12 mutations, all red after rebuilding one.
- **What worked:** Seeding localStorage with a past startedAt in Playwright (no waiting) to prove reload/Stop/Add/Discard; negative "no insert" scoped to actid>startMax with actwho=1 or null on any case; unit-testing TimerView's server-rendered markup for the journey-03 label trap.
- **What failed:** First mutation for "key cleared on ?error=" (inside the mount effect) survived — the server-action error redirect is a soft navigation, so the Timer never remounts and the effect doesn't re-run; the realistic mutation (page passes clearOnAdded on error) went red.
- **Remember next run:** Client components on /time persist across server-action redirects — mount-only effects re-run only when their props/deps change; build mutations at the prop source (page.tsx), not in unreachable effect branches. ta.timer shape: {caseId:string, startedAt:ms, description, stoppedAt?:ms}. edit.live defaults to port 3102 — pass BASE_URL. The only profiles row is staff@example.test (personid null).

## 2026-09-12 15:40 — dev-team-auto — Time panel on the case page
- **Outcome:** DONE — 1 attempt — caution: no — team: dt-engineer (opus, medium) — auto/time, 0eda1d5
- **What happened:** Server-component TimePanel (+ pure TimePanelView) in app/cases/[id]/time-panel.tsx, listCaseTime/unbilledHours in lib/time/case.ts; page.tsx +2 lines. Engineer self-verified; orchestrator ran gates + 10 mutations.
- **What worked:** Pure view component rendered via renderToStaticMarkup in unit tests made every mutation (filter, order, both unbilled conds, both marker conds, empty branch, link, /bills/i) trip a named guard. Toggling the panel out of page.tsx proved journey 02's failure pre-existing in one run.
- **What failed:** Mutation "join initials on actid" survived at first — test rows had actid == actwho; fixed by adding actid 12 / actwho 2. A zsh `$T` command variable doesn't word-split, so a mutation run silently executed nothing; use a function or inline command. Journeys run in 2 workers both died on page.goto ERR_ABORTED — run with --workers=1. A dev server started in the background by a subagent is killed when that subagent's turn ends.
- **Remember next run:** Journey 02 is NOT green at integration: strict getByText(/firm/i) hits the header "Firms" nav link + case page "Firm" heading (pre-existing since the cases hand-test round 2 nav; app-shell/journey owner decision). Journey 01 now passes. Initials come from tblbillingnames via a JS Map join (no FK from actwho), as in app/time/week-view.tsx. listCaseTime is unpaged (1000-row cap).

## 2026-09-12 16:25 — dev-team-auto — Running-timer indicator + E2E staff seed
- **Outcome:** DONE — 2 attempts — caution: no — team: dt-engineer opus/medium, dt-engineer opus/high — auto/time, def5569
- **What happened:** Header indicator (app/time/running-indicator.tsx, TIMER_EVENT/formatHm/indicatorView in lib/time/timer.ts) and staff E2E seed at personid 1. Attempt 1 set personid 1 inside the shared seedE2eUser, which linked every throwaway/admin account to KJS; users.live:319 caught it at the gate. Attempt 2 added an optional personid arg (default null) + seedStaffE2e used only by the seed command and seed-e2e.check.ts.
- **What worked:** same-tab window event from timer.tsx store.set/clear plus 60s tick plus pathname re-read; live tests driving real Start/Discard/Add clicks and page.clock.runFor(61s); unit render via react-dom/server with a stubbed localStorage for the hydration guard; hosted profiles before/after JSON diff around the seed.
- **What failed:** editing a shared test helper's default instead of adding a staff-only path; the engineer then also edited two more app-shell live tests beyond the allowed minimum (reverted). A perl -0pi mutation inserting a non-ASCII char double-encoded the existing "⏱" and turned unrelated tests red; redo with ASCII.
- **Remember next run:** tests/cases/shell-wiring.test.mjs:70, tests/cases/inquiries.live.test.mjs:113, tests/app-shell/users.live.test.mjs:40 and shell.live.test.mjs:33 re-seed staff@example.test with personid null — run tests/app-shell/seed-e2e.ts after pnpm test before journey 03, or switch those call sites to seedStaffE2e. Journey 02 creates a tblcase + tblinquiry and journey 03 a tblactivity row on hosted each run, and the ids are reused (actid 12, case 90005, inquiry 33 twice) — delete by exact values. Grep every caller before changing a shared seed/test helper.


🤖 Generated with [Claude Code](https://claude.com/claude-code)

https://claude.ai/code/session_0133tojzeF7hGqxpDmkud1mZ
