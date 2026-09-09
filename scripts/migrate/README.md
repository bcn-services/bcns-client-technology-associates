# Migration runbook — SQL Server `.bak` → Supabase

Everything here is run by us (Nate, or whoever runs cutover). **Kris installs nothing and runs nothing** — his only action, ever, is freezing Access (Part 2, step 1).

Run every command from the repo root.

---

## Part 1 — Restore the `.bak` and generate the load script

### 1.1 One-time tooling

```sh
brew install colima docker
python3 -m venv ~/.venvs/mssql-scripter
~/.venvs/mssql-scripter/bin/pip install --pre mssql-scripter
```

`mssql-scripter`'s only published releases are pre-releases, so `--pre` is required or pip finds no candidate. Do **not** use the `bin/mssql-scripter` wrapper — its last line calls `python`, which does not exist on macOS (only `python3`). Invoke the module through the venv's own interpreter, as step 1.5 does.

### 1.2 Start the SQL Server container

```sh
colima start --vm-type vz --vz-rosetta --memory 4 --disk 20

export SA_PASSWORD="$(openssl rand -base64 24)Aa1!"   # shell only — never written to a file
export BAK_DIR="$HOME/ta-bak"                          # host dir holding the .bak
mkdir -p "$BAK_DIR"

docker run -d --name ta-mssql --platform linux/amd64 \
  -e ACCEPT_EULA=Y -e MSSQL_SA_PASSWORD="$SA_PASSWORD" \
  -p 1433:1433 -v "$BAK_DIR":/bak \
  mcr.microsoft.com/mssql/server:2022-latest
```

The SA password lives in the `SA_PASSWORD` shell variable of the operator's session and nowhere else. Never paste its value into this file, a script, a commit, or a ticket. Closing the shell is how it is disposed of; `docker rm -f ta-mssql` when done.

### 1.3 Put the `.bak` in the mounted dir

Unzip the archive Kris supplied **on the host**, into `$BAK_DIR`:

```sh
unzip -j /path/to/TechAssoc-backup.zip '*.bak' -d "$BAK_DIR"
ls "$BAK_DIR"          # note the exact .bak filename → $BAK
export BAK=TechAssoc.bak
```

### 1.4 Read the logical file names, then restore

Never hardcode logical file names — read them from this output every run:

```sh
docker exec ta-mssql /opt/mssql-tools18/bin/sqlcmd -C -S localhost -U sa -P "$SA_PASSWORD" \
  -Q "RESTORE FILELISTONLY FROM DISK = N'/bak/$BAK'"
```

Take the `LogicalName` of the data row (`Type` D) and the log row (`Type` L) and substitute them below:

```sh
docker exec ta-mssql /opt/mssql-tools18/bin/sqlcmd -C -S localhost -U sa -P "$SA_PASSWORD" \
  -Q "RESTORE DATABASE TechAssoc FROM DISK = N'/bak/$BAK' WITH \
      MOVE N'<data LogicalName>' TO N'/var/opt/mssql/data/TechAssoc.mdf', \
      MOVE N'<log LogicalName>'  TO N'/var/opt/mssql/data/TechAssoc_log.ldf', \
      REPLACE"
```

### 1.5 Record SQL Server's own row counts

Run this against the database you just restored, **before** generating the export. It is the only
ground truth for how many rows *should* exist — the export cannot prove its own completeness, and
a silently truncated scripter run leaves the export and the database agreeing on a wrong number.
Part 2 step 5 reads this file and compares it per table.

```sh
mkdir -p scripts/migrate/out
docker exec ta-mssql /opt/mssql-tools18/bin/sqlcmd -C -S localhost -U sa -P "$SA_PASSWORD" \
  -d TechAssoc -h -1 -W -s"|" -Q "
SET NOCOUNT ON;
DECLARE @s nvarchar(max) = N'';
SELECT @s = @s + N' UNION ALL SELECT ''' + LOWER(name) + N''' AS tbl, COUNT_BIG(*) AS n FROM dbo.' + QUOTENAME(name)
FROM sys.tables WHERE LOWER(name) IN (
  'tblstates','tblbranches','tblcasestatus','tblcasepriority','tblcasewaitingfor',
  'tblbillingnames','tblexptype','tblfirm','tblattorney','tblclient',
  'tblinquiry','tblcase','tblbills','tblactivity','tblexpenses',
  'tblfundsrcvd','tblsrvauth','tblcaseresult','tbl_scannedbillandcheck','tblscanneddocument');
SET @s = STUFF(@s, 1, 11, N'') + N' ORDER BY tbl';
EXEC(@s);" | tee scripts/migrate/out/source-counts.txt
```

`EXEC()` takes a variable, not an expression, so the concatenation happens in the `SET` first.
`LOWER(name)` appears twice on purpose: in the `WHERE` because `sys.tables` matching is
case-sensitive under some collations, and in the projection because the real `.bak` stores
mixed-case names (`tblCase`, `TblScannedDocument`). Verify matches this file's table names
against a lowercase list and exits 2 naming every table it could not find, so either mistake
stops the run loudly rather than silently — but it stops it at step 5, after the export.
**Check the file has 20 lines, all lowercase, before continuing.**

One `table|count` line per table. A table legitimately holding zero rows needs no flag in
step 5: this file says so, and verify reports it as `ok (empty in SQL Server)`.

### 1.6 Generate the data-only load script

```sh
mkdir -p scripts/migrate/out
PYTHONIOENCODING=utf8 ~/.venvs/mssql-scripter/bin/python -m mssqlscripter -S localhost -d TechAssoc -U sa -P "$SA_PASSWORD" \
  --data-only --target-server-version vNext \
  --include-objects dbo.tblstates dbo.tblbranches dbo.tblcasestatus dbo.tblcasepriority dbo.tblcasewaitingfor dbo.tblbillingnames dbo.tblexptype dbo.tblfirm dbo.tblattorney dbo.tblclient dbo.tblinquiry dbo.tblcase dbo.tblbills dbo.tblactivity dbo.tblexpenses dbo.tblfundsrcvd dbo.tblsrvauth dbo.tblcaseresult dbo.tbl_scannedbillandcheck dbo.tblscanneddocument \
  -f scripts/migrate/out/export.sql
```

Twenty tables, in dependency order. `scripts/migrate/out/` is gitignored — the export never enters git.

---

## Part 2 — Cutover sequence

1. **Kris freezes Access.** No further edits in the legacy app from this moment. This is his only step.
2. **Get the latest `.bak`.** Today: the copy Kris has already placed for us. At go-live: pull the client's most recent nightly S3 backup ourselves. Either way, zero clicks from Kris.
3. **Restore and generate** — Part 1, steps 1.2 through 1.6. (1.1 only on a fresh machine.)
4. **Load:**
   ```sh
   node scripts/migrate/load.mjs scripts/migrate/out/export.sql
   ```
   Clears the 20 legacy tables and inserts the export in one transaction; any failure changes nothing. Prints rows inserted per table.

   Clearing is a row-level `DELETE`, not `TRUNCATE`: `profiles.personid` and `bank_transactions.expid`/`fndsid` reference three of the 20, so `TRUNCATE` would demand those tables be named too (or `CASCADE`). The load must never touch them, so it deletes instead — under `session_replication_role = replica`, which also keeps the `NOT VALID` FKs and the `audit` triggers quiet for that session only.

   **Timezone.** The load pins its session to `America/New_York`, so a naive SQL Server `datetime2` landing in a `timestamptz` column (only `tblcase.casestatlastupdated`) resolves to the same instant no matter which machine or shell runs it. Access wrote these values as Eastern wall-clock times, so Eastern is how they are read back — decided 2026-09-09. **Do not change the one `set time zone` line in `load.mjs` after go-live:** every stored instant would move, and the go-live re-run must use the same setting as every trial run.
5. **Verify:**
   ```sh
   node scripts/migrate/verify.mjs scripts/migrate/out/export.sql \
     --source-counts=scripts/migrate/out/source-counts.txt
   ```
   Compares SQL Server's own row counts, every numeric-column sum, and **every cell of every row** against the database, and reports identity maxima, orphan rows per `NOT VALID` FK, denormalized-column drift, and the max length of every `ntext`-derived text column. Prints a Markdown table and writes it to `scripts/migrate/out/verify-<timestamp>.md`.

   **Exit 0 means five things hold:** every table holds exactly as many rows as SQL Server reported in step 1.5, every numeric column's sum matches the export, **every row in the export appears in the database cell for cell and no other row does**, every identity sequence's next value clears its table's max id (so the app's first insert cannot collide), and no legacy table is unexpectedly absent from the export. Orphans and drift are informational and never fail the run.

   **The row-level comparison is the check that catches a changed value.** Counts and sums are blind to a truncated note, a swapped name, a date shifted by a day, a flipped flag, a case repointed at a valid but wrong client, or a cent moved from one row to another — every one of those leaves the count and the total exactly right. The comparison rebuilds each table's rows from the export, casts each literal to that column's own Postgres type, and takes the difference both ways (`except all`), which keeps duplicate rows and treats null as equal to null. A table reported **ROWS DIFFER** shows how many rows are on one side only; the same number on both sides usually means values changed rather than rows going missing. It deliberately does not reuse `load.mjs`'s value translation: a bug in there would corrupt both sides the same way and the check would pass.

   The line under that table says whether any export column was excluded. A column the export carries that the Postgres schema has no counterpart for is never loaded, so the comparison cannot speak for it — the report names those columns instead of quietly narrowing what it checked.

   A table reported **TRUNCATED EXPORT** holds fewer rows than SQL Server does: the scripter run dropped rows. Regenerate the export (step 1.6) and reload — never acknowledge it away.

   `--source-counts` is mandatory. The only way to run without it is `--no-source-counts`, which narrows the check to export-vs-database and cannot detect a truncated export; the report says so on its face, so an archived run is never ambiguous about what was checked. In that mode a table with no rows on either side is reported **EMPTY — no INSERTs in export** and fails until `--allow-empty=<table>` (comma-separated for several) acknowledges it — which the report also records. Use it for a dry run against a scratch database, never for cutover.
6. **Seed logins:**
   ```sh
   node_modules/.bin/tsx scripts/migrate/seed-logins.mjs scripts/migrate/in/logins.json
   ```
   Creates the first Supabase auth users and their `profiles` rows from an array of `{ email, role: "admin" | "staff", personid }` (see `scripts/migrate/logins.example.json`). No passwords are set — users come in through the app's invite/reset flow. Idempotent on email. Put the real file at `scripts/migrate/in/logins.json`; that directory is gitignored. Run it under `tsx`, not `node`: it imports `createServerClient()` from `lib/db/client.ts`, so it also needs `NEXT_PUBLIC_SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` in the environment.
7. **Hand over.** Tell Kris the new app is live and Access stays frozen.

All three scripts read the target database from the `MIGRATE_DB_URL` environment variable; only `verify.mjs` takes flags, listed above (step 6 additionally needs the two Supabase variables above):

```sh
export MIGRATE_DB_URL="postgresql://…"   # the Supabase project's connection string
```

### If verify exits non-zero

**Stop.** Do not run step 6, do not hand over.

- Keep Access frozen or tell Kris to resume it — decide before anything else; the legacy app is the system of record until we hand over.
- Send `scripts/migrate/out/verify-<timestamp>.md` back with the mismatched tables.
- Fix the cause in the repo, then restart from Part 2 step 3 with a fresh `.bak`. **Re-run step 5 and confirm it exits 0 before going anywhere near step 6** — a second load with an unresolved mismatch must never reach hand-over. `load.mjs` clears every legacy table (`delete from`, in reverse dependency order) and reloads inside one transaction, so a re-run is safe and leaves no duplicates. It does not `truncate`: `profiles` and `bank_transactions` reference three of these tables, and `truncate` would demand naming them or `cascade` — either one reaches beyond the legacy tables this lane owns.

---

## Part 3 — Human pre-steps and the go-live re-run

Two steps must happen once, by a person, before Part 2 can run:

1. **Rotate the `TechAssoc` SQL Server password** on the client's server. No repo code depends on it; it is out of scope for this lane and must simply be done before cutover.
2. **Create the Supabase project and set `MIGRATE_DB_URL`** to its Postgres connection string (see `~/os` memory `reference-bcns-ci-setup` for the standard secrets/vars set).
3. **Apply the schema to it.** `load.mjs` creates nothing; it inserts into tables that must already
   exist. Apply **every** file in `supabase/migrations/`, in filename order — `0006` is not optional,
   and a database at `0005` fails the load on the first `tblcase` row with a NULL
   `casestatharddeadline`:

   ```sh
   for f in supabase/migrations/*.sql; do
     psql -X -q -v ON_ERROR_STOP=1 -d "$MIGRATE_DB_URL" -f "$f" || break
   done
   psql -X -At -d "$MIGRATE_DB_URL" -c \
     "select count(*) from information_schema.tables where table_schema='public'"   # expect 23
   ```

   Equivalently `supabase db push` once the project is linked. Re-running Part 2 against an
   already-migrated database needs no re-apply unless a migration was added since.

**The go-live re-run is identical to the first run in every step except one:** the `.bak` in step 2 of Part 2 comes from the client's nightly S3 backup instead of a manual copy. Same container, same restore, same `mssql-scripter` invocation, same three scripts, same `MIGRATE_DB_URL`. Nothing else changes, and Kris still installs and runs nothing.
