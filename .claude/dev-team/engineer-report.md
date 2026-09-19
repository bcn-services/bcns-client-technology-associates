# Engineer Report
**Task:** LANE.md item 1/6 — detail-list report engine in `lib/reports/detail.ts`
**Branch:** auto/docs-reports
**Date:** 2026-09-19

VERDICT: BUILT — 12/12 own tests pass, 16/16 mutants killed, tsc clean; perf live-DB half UNMET by instruction.

## Design Decisions
- Paging: idiom A (count-first then parallel `.range()` pages, `lib/expenses/list.ts:42-59`), not the sequential `all()` of `lib/cases/presets.ts:17-28` — a full-year range is the slow case and its pages are independent, so one exact count plus N concurrent reads beats N serial round trips.
- `Db` type: the structural `Db` from `@/lib/time/entries` (what `lib/expenses/list.ts` and `lib/funds/case.ts` use); callers must write `createServerClient() as unknown as Db`, exactly as `app/expenses/page.tsx:18` does.
- DEVIATION from the item text: `requireSession()` is NOT called inside the module. No lib query module in this codebase calls it; the house entry point is the page, via `Promise.all([requireSession(), <query>])`. Reported per instruction rather than silently threaded in.
- Rows are sorted in JS after page assembly (`byDate`), not left to `.order()` — page concatenation must not decide row order, and this is what makes the ordering criterion assertable on module output.
- The per-type summary is folded from the returned detail rows, so it can never disagree with them and can never name a type with no activity in the period. Both criteria fall out of one construction.
- `tblexptype` is read with no `active` predicate at all; `active` is nullable, so `.eq("active", ...)` or a truthiness test would drop retired types. `expcaseid`/`fndscaseid` are never filtered, so firm-wide rows are in.
- Income attorney resolved by two paged lookup reads (`tblcase`, `tblattorney`) joined in JS — no PostgREST embed, matching `lib/time/case.ts:18`. Marked `ponytail:` with the `.in()` upgrade path.

## Files Changed
- `lib/reports/detail.ts` — NEW. `expenseDetail(db, f)` and `incomeDetail(db, f)`, `DetailFilter` {start, end, exptype?, description?, branch?}, row/summary types. Imports `toCents`/`fmtCents` from `@/lib/expenses/list` and `escapeLike` from `@/lib/cases/search`. Select-only.
- `tests/docs-reports/fakedb.mjs` — NEW. PostgREST fake with real `gte`/`lte`/`ilike`/`count`/`range`, a deliberately no-op `.order()` (so ordering assertions can only be satisfied by the module), and `writes`/`reads` statement counters.
- `tests/docs-reports/report-detail.test.mjs` — NEW. 12 tests: T1 null `expcaseid` included, T2 retired types (active null + active false), T3a boundary, T3b ordering on scrambled fixture, T4/T4b/T4c type/branch/description filters each with a single-field decoy, T5 2500 rows across 3 pages, T6 integer-cent summary + grand total, T7 `db.writes === 0` driving the real engine, T8 income attorney join + firm-wide receipt, T9 summary omits quiet types.
- `tests/docs-reports/perf.mjs` — NEW. Median-of-5 at 50,000/10,000 rows against the fake; the live half refuses to run (`REPORTS_PERF_LIVE=1` exits 2) until pointed at a throwaway DB.

## Raw summary lines
- Own tests — `npx tsx --test --test-concurrency=1 tests/docs-reports/*.test.mjs`: `# tests 12  # pass 12  # fail 0  # skipped 0`
- Perf — `npx tsx tests/docs-reports/perf.mjs`: `runs(ms): 176, 237, 222, 219, 232  median: 222 ms  budget: 2000 ms  PASS (module overhead only, fake DB)`
- `BASE_URL=http://localhost:3999 npm test`: `# tests 966  # pass 734  # fail 3  # skipped 229  # duration_ms 65859.563958`
- `npx tsc --noEmit`: no output, exit 0.

## Findings
- [Important] `npm test` here is 966/734/3/229, NOT the stated 771/0/215/986 baseline. Cause: this worktree has no `node_modules`, so `npx` resolves tsx from outside and the two TZ guards spawn `node_modules/.bin/tsx` → `spawnSync ... ENOENT`. Proved not mine: with `lib/reports/` and `tests/docs-reports/` moved off disk entirely, the same three still fail — `guard i: daysSinceNotice/isDue ... TZ` (tests/billing/rules.test.mjs), `guard d: weekBounds ... TZ` (tests/time/week.test.mjs), `tests/cases/inquiries.live.test.mjs` (no server). Install deps in the worktree to get a real regression read.
- [Important] Perf criterion live-DB half UNMET by instruction: no rows were seeded into the client's hosted Supabase project. **Rows left in any live database: 0.** Only the module's own overhead was measured (222 ms median at 50k/10k) — PostgREST round trips are unmeasured.
- [Minor] Mutation overlap: M10 (summary seeded with every type) trips T9 *and* T6, and M2 (`active` gating the report) trips T2 *and* T6, because T6's expected map is keyed by type name. T9 and T2 are the isolating assertions; T6 is collateral.
- [Minor] Item text says "`requireSession()` at the entry point"; the module does not call it. Page-level `Promise.all([requireSession(), expenseDetail(...)])` is required of item 2+ or the report is unauthenticated.
- [Minor] `tests/docs-reports/*.test.mjs` is not in `package.json`'s enumerated `test` script, so these 12 tests never run under `npm test`. Out of scope here (package.json unowned) — someone must add the glob.

## Deferred / Out of Scope
- No `/reports` page, no P&L / YearlyExpense / accountant-export cuts, no `data-testid="report-results"` wiring — later lane items.
- Live-DB seeded perf run; `package.json` test glob.

## Flags for Reviewer
- `incomeDetail` pages all of `tblcase` and `tblattorney` on every call regardless of range size — unbounded in table size, not range size. `ponytail:` marked; swap to `.in()` on the case ids actually present if those tables grow.
- `expenseDetail` holds the whole matching range in memory and sorts it in JS — 50k rows measured fine, but there is no cap.
- Count-first paging races: if rows are inserted between the count and the parallel page reads, later pages can shift. Read-only report over closed months, so low risk, but it is a real window.
- `.ilike` on `expdscr`/`fndsdesc` has no index behind it as far as this module knows — a substring cut over a full year is the likeliest live slow query.
