# Lane Acceptance Review — `time`
**Date:** 2026-09-12
**Diff:** `git diff lane/time...auto/time` (auto/time HEAD def5569), 29 files, +2550/-8
**Files Reviewed:** 29 (15 source/wiring, 14 tests)
**Mode:** read-only. No dev server, no live/journey runs. Ran: `tsc --noEmit` (exit 0); every non-live `tests/time/*.test.mjs` — case 13/13, edit 34/34, entries 28/28, indicator 8/8, seed-e2e 5/5, timer 15/15, week 30/30 (133 pass, 0 fail).
**Dimensions Swept:** Efficiency — clean · Reliability — 3 (1 Important, 2 Minor) · Scalability — 1 (Minor) · Safety & Security — clean (battery rows swept: every-diff, DB query, auth/session, rendered content, state-changing form, redirect-from-input) · Fault Tolerance — 1 (Minor) · Data Integrity — 1 (Minor) · Over-Engineering — clean

## Acceptance criteria

### (a) Journey 03 through `/time`; row has `actwho` = login's person, `actbilled=false`, `actbillid` null — **MET in code; the journey pass itself is UNVERIFIED-BY-CODE and depends on test order (see Important #1)**
- `actwho` comes from the session only: `lib/time/entries.ts:73-77` (`insert({ ...row, actwho: personId })`; `row` = parseEntry whitelist `:62`). `app/time/actions.ts:13` reads only case/date/hours/description.
- `actbilled`/`actbillid` never written; the schema defaults to `actbilled boolean not null default false` (`supabase/migrations/0001_legacy_schema.sql:190`), and `actbillid` is nullable with no default (`0002_billing_time_columns.sql:6`).
- Journey selectors: one "Case"/"Hours"/"Description" label (`app/time/entry-form.tsx:26-41`), one "Add entry" button (`:44-47`), "Entry added" (`app/time/page.tsx:29`). The timer label is "Timer note" (`app/time/timer.tsx:42-45`); the header indicator has no aria-label (`app/time/running-indicator.tsx:14`).
- Staff E2E login linked: `tests/app-shell/seed-e2e.ts:43-49,83` (`seedStaffE2e` → personid 1).
- Tests: `entry.live.test.mjs` "linked staff: case 90001, 1.5h 'Reviewed file' → 'Entry added' and an unbilled row with actwho = personId" (**live**, asserts `actwho:1, actbilled:false, actbillid:null`); `entry.live` "/time has exactly one Case, one Hours…" (**live**); `timer.live` "journey 03 selectors stay strict with the timer running and stopped" (**live**); `seed-e2e.test.mjs` (i) and regression (unit, passing); `entries.test.mjs` (unit, passing). Journey 03 itself was not run here.

### (b) Timer on 90001 → stop → save gives hours = nearest 0.125 (floor 0.125); shows under today in the week view; editing its description there persists — **MET in code; no single test covers the whole chain**
- Rounding: `lib/time/timer.ts:17-22` (`Math.max(1, Math.round(ms/450000))/8`), applied only on Stop (`:77-80`, `app/time/timer.tsx:91-97`). The server stores the string unchanged (`entries.ts:37-43`).
- "Under today": the fill date is `firmToday(stoppedAt)` (`timer.ts:79`), and the default week is `weekBounds()` → `firmToday(new Date())` (`lib/time/week.ts:27-31`). The week row links to `/time/<actid>` (`app/time/week-view.tsx:80`).
- Edit persists: `entries.ts:113-131` (changed columns only, filtered UPDATE), `actions.ts:41-62` → `/time?week=<date>&saved=1`.
- Tests: `timer.test.mjs` "Stop after 3 s/7 min/40 min/2 h 4 min" = 0.125/0.125/0.625/2.125 (unit, passing); `timer.live` "reload mid-run… Stop → Add entry inserts rounded hours and clears the key" (**live**, but on invented case 990401, not 90001); `week.test.mjs` "weekBounds() with no arg equals the bounds of firmToday()" (unit, passing); `edit.live` "staff edits own unbilled row: hours + description persist" (**live**, on a service-role-inserted row, reached by URL rather than from the week view). The timer-made row → week view today → edit link path is not exercised end to end (Minor #1).

### (c) `/cases/90001` Time section lists both fixture rows; "Unbilled hours" = 2.000 — **MET in code; the live test does not assert 2.000 (Important #2)**
- Panel wired: `app/cases/[id]/page.tsx` +2 lines (import, `<TimePanel caseId={id} />`). `app/cases/[id]/time-panel.tsx:17-49` renders rows, the billed marker (`:36`), and `Unbilled hours: {unbilledHours(rows)}` (`:41`).
- Sum rule: `lib/time/case.ts:35-37` filters `actbilled === false && actbillid == null`, in integer thousandths.
- Tests: `case.test.mjs` FIXTURE (`:39-40`) plus guards D/E (`:63-68`) = "2.000" (unit, passing); `case-panel.live` "live A" (**live**) asserts "KJS 2.000 Site inspection" (no marker) and "JON 1.500 Photo review billed", but at `:63` it only checks the shape of the unbilled line, and "live B" `:82` just logs when the value isn't 2000.

### (d) Editing/removing a billed row from any time screen is refused, row unchanged, refusal in the write statement's filter — **MET**
- `lib/time/entries.ts:93-96` `editableOnly` = `.eq("actid").eq("actbilled", false).is("actbillid", null)` (+ `.eq("actwho", personId)` for staff), applied to the UPDATE itself (`:126`) and the DELETE itself (`:136`). Zero rows → "locked" (`:129,:138`). The no-change path (`:127`) writes nothing and uses the same filter.
- Billed rows render read-only with no buttons: `app/time/[id]/page.tsx:32-38`, `entry-form.tsx:24,44`. The week view (`week-view.tsx`) and the case panel have no write paths.
- Tests: `edit.test.mjs` "update/delete chain filters eq actbilled false / is actbillid null / eq actwho for staff" (unit, passing); `edit.live` "fixture row 2: replayed update and delete (admin and staff) report 'can't be changed'; row 2 identical in every column" (**live**, forged bound actid); `edit.live` "fixture row 2: direct lib calls as admin (service-role client, no RLS) are refused 'locked'" (**live**); `edit.live` "fixture row 2 (billed): admin page is read-only…" (**live**).

## Global rules
| Rule | Verdict | Evidence |
|---|---|---|
| No writes to `actbilled`/`actbillid` | MET | insert `entries.ts:77`; update payload built only from parseEntry keys (`:115-121`). Test `edit.test` "update payload never carries forged actwho/actbilled/actbillid" (unit). The live tests read those columns but never write them. |
| personId-null refused server-side | MET | `actions.ts:15,48,69` + lib `entries.ts:74,114,135` (every role, admin included); pages `app/time/page.tsx:25-26`, `[id]/page.tsx:26`. Test `entry.live` "personId null: … a replayed addEntry POST inserts nothing" (**live**, with control). |
| Staff limited to own `actwho` | MET | writes `entries.ts:95`; read `:101`; week `week.ts:86-89` (`?who=` ignored for staff). Tests `edit.test` actwho filters (unit), `week.test` staff `?who=2` (unit), `edit.live` "staff vs another person's unbilled row" (**live**). |
| No migrations / schema changes | MET | Nothing under `supabase/migrations/**` or `lib/db/**` in the diff. |
| No `process.env` outside `lib/env.ts` | MET for app/lib (grep of `app/time`, `lib/time`, `time-panel.tsx`: 0 hits). Test files read `process.env` the same way the existing `tests/cases/*.live.test.mjs` do. |
| Diff inside owned + permitted paths | MET | All files are under `app/time/**`, `lib/time/**`, `tests/time/**`, or are the permitted wiring files: `app/cases/[id]/page.tsx` (+2 exactly), `app/cases/[id]/time-panel.tsx` (named by item 5), `app/layout.tsx` (import + one child exactly), and `tests/app-shell/seed-e2e.ts` / `seed-e2e.check.ts`. Note: the seed edit is wider than "touches only the staff profile's personid". It adds `STAFF_PERSONID`, `seedStaffE2e`, and a defaulted `personid` param to `seedE2eUser`. Existing callers keep null (proved by `seed-e2e.test` regression). No file is outside the lists. |

## HIGH-severity correctness / security findings
None. The bound `actid` in `.bind(null, actid)` is forgeable from the client, but every write re-checks it in the statement filter, and the live replays prove the refusal. Error redirects are prefixed `/time/`, so they cannot become open redirects. React escapes all user text, and there is no raw HTML sink.

## Findings

### Important
- tests/app-shell/seed-e2e.ts:56-72 (with tests/cases/shell-wiring.test.mjs:70, tests/app-shell/shell.live.test.mjs:33, tests/app-shell/users.live.test.mjs:40) — Reliability — these callers run plain `seedE2eUser` on the same `E2E_EMAIL` staff login, and it upserts `personid: null`. That undoes the staff seed's personid 1. No playwright globalSetup re-seeds, so journey 03's `/time` step passes only if `seed-e2e.ts` ran after them (shell-wiring is in the default `pnpm test` glob and runs whenever a dev server is up) — fix: point those three staff-login calls at `seedStaffE2e`, or have `seedE2eUser` leave `personid` out of the upsert when none is passed so an existing link survives.
- tests/time/case-panel.live.test.mjs:63 — Reliability — the live check reads "Unbilled hours" but never asserts it equals 2.000, and `:82` only logs when it differs, so criterion (c)'s number has no live proof. Also, journey 03 inserts 1.5 h on 90001 with no cleanup, so the shared DB can drift to 3.500 — fix: assert `unbilled() === 2000` in live A after deleting rows on 90001 with `actid > 2`, or assert against the DB-computed unbilled sum.

### Minor
- tests/time/timer.live.test.mjs:87-118 — Reliability — criterion (b)'s chain (timer on 90001 → save → row under today in the default week view → edit its description through the week-row link) is covered only in pieces, on case 990401 and on a service-role row — fix: extend the timer live test to open `/time`, find the new row in `week-table` under today's date, follow its link, edit the description, and assert the DB value.
- app/time/entry-form.tsx:36 — Data Integrity — the Hours input is `step="0.001" min="0.001"`, but item 1 specifies `step="0.125" min="0.125"`. The server still enforces 0 < h ≤ 24 with ≤ 3 decimals, so this only widens what the browser accepts — fix: keep it as is and record the deviation in LANE.md (0.125 would block typed values like 1.1), or switch to the spec'd attributes.
- app/time/week-view.tsx:19 — Fault Tolerance — a failed `tblbillingnames` read comes back as `[]`. The admin Person select then renders empty with no error, unlike the week/unbilled reads, which show a failure note — fix: route it through `soft()` and show "Couldn't load people" when it returns null.
- lib/time/case.ts:19-25 — Scalability — the case panel reads unpaged (PostgREST caps at 1000 rows), so a case with more than 1000 entries silently truncates both the list and the unbilled total. This is marked `ponytail:` — fix: page it the way `lib/time/unbilled.ts:11-27` does, when needed.
- package.json:12 — Reliability — `tests/time/*.test.mjs` is not in the `test` script yet, so these 133 unit tests don't run in `pnpm test`. LANE.md assigns this to the Reviewer at merge — fix: add the glob at merge, as planned.

## STANDARDS.md Updates
None. Skipped: this review was scoped read-only.
