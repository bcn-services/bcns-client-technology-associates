# Team memory — Technology Associates

Durable gotchas and dead ends, in merge order. Read before planning work that
touches the same area. Never reset.

---

## lane: migration — merged 2026-09-09 (PR #1, merge `a3add4b`, last lane commit `3f65565`)

**A verifier that reads only the export file cannot prove the export is complete.**
`verify.mjs` originally compared database against export. A silently truncated
`mssql-scripter` run scored source=0 / db=0 per table and reported `ok`. Two
acceptance rounds were needed to close it: the first added an `EMPTY` guard, which
still passed a *partially* truncated export. The fix is that verify reads SQL
Server's own per-table counts (`out/source-counts.txt`) and compares three ways.
The flag is mandatory; `--no-source-counts` narrows the check and says so in the
report header, so an archived run is never ambiguous about what was verified.

**`pg_sequence_last_value` is not the next value.** `setval(seq, max, false)` parks
the next value *on* the max id and collides on the first insert, yet reports
`last_value = max`. Any sequence check must read `is_called`, and the report
should print the next value, not the last.

**A sibling signal can mask the guard under test.** Twice this run a mutation
survived because an unrelated mismatch failed the run first — an allow-empty
isolation case exited 1 on an ordinary count mismatch and never reached the
coverage guard. When a mutation survives, suspect the test's setup before the code.

**`mssql-scripter`'s `bin/` wrapper is broken on macOS** — its last line calls
`python`, which does not exist here (only `python3`). Invoke the module directly:
`PYTHONIOENCODING=utf8 ~/.venvs/mssql-scripter/bin/python -m mssqlscripter`.

**`sys.tables` returns mixed-case names** (`tblCase`, `TblScannedDocument`) and
`verify.mjs` matches against a lowercase list. The runbook's counts query must
`LOWER(name)` in both the `WHERE` and the projection, or verify exits 2 at step 5
— after the export has already been generated.

**`EXEC()` takes a variable, not an expression.** `EXEC(STUFF(...) + N'...')` is
invalid T-SQL; assign with `SET` first, then `EXEC(@s)`.

**`load.mjs` creates nothing.** It inserts into tables that must already exist, so
every file in `supabase/migrations/` has to be applied to the target database
first. This was missing from the runbook and would have killed cutover day.

**Deliberate:** `load.mjs` uses per-table `delete from` in reverse dependency order
rather than `truncate`, because `profiles` and `bank_transactions` reference three
of the 20 legacy tables and `truncate` would need `CASCADE` — which reaches outside
this lane's owned paths.

---

## foundation amendment — merged 2026-09-09 (PR #2, merge `2cab8db`, commit `c2b3bf6`)

Reviewer-side amendment to `supabase/migrations/**`, split out of the migration
lane because that path is `protected:`. Landed as a new migration
(`0006_trial_load_fixes.sql`); `0001` was not edited.

**Our schema was stricter than the source in three ways, all found only by loading
the client's real `.bak`, not by reading `LEGACY.md`:**

1. **17 of 19 `bit` columns are nullable in SQL Server**, ours were `not null`.
   2,876 real `tblcase` rows carry a NULL `casestatharddeadline` — load-fatal.
   The rule is that legacy data loads as-is, so the `not null` goes and the
   `default false` stays. Do **not** coerce legacy nulls to false on load.
   `tblcase.billingalert` and `tblactivity.actbilled` really are `not null` at
   source and stay that way — which keeps `0002`'s `actbillid` check two-valued.
2. **SQL Server `real` needs `numeric(9,3)`, not `numeric(8,2)`.** Seven
   `srvauthhours` rows need the third decimal; `numeric(8,2)` rounded them and the
   column sums then disagreed.
3. **`tblcase.casestatusharddeadline` was a phantom** duplicating
   `casestatharddeadline` — it exists in no source table. Dropped.

**Lesson for any future schema derived from a legacy database: nullability and
numeric width must come from `sys.columns`, not from a written spec.** A trial
load against the real backup is the only thing that finds this class of defect.

**`scripts/migrate/out/` and `in/` are now in the root `.gitignore`.** They were
only covered by `scripts/migrate/.gitignore`, which does not exist on `integration`
— a `git add -A` on a foundation branch staged ~200 verify reports containing real
client data. Caught before commit. The rule now survives on any branch.
