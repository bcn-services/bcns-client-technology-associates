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

`mssql-scripter`'s only published releases are pre-releases, so `--pre` is required or pip finds no candidate. Invoke it by its venv path below.

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

Sanity check:

```sh
docker exec ta-mssql /opt/mssql-tools18/bin/sqlcmd -C -S localhost -U sa -P "$SA_PASSWORD" \
  -d TechAssoc -Q "SELECT COUNT(*) FROM dbo.tblcase"
```

### 1.5 Generate the data-only load script

```sh
mkdir -p scripts/migrate/out
~/.venvs/mssql-scripter/bin/mssql-scripter -S localhost -d TechAssoc -U sa -P "$SA_PASSWORD" \
  --data-only --target-server-version vNext \
  --include-objects dbo.tblstates dbo.tblbranches dbo.tblcasestatus dbo.tblcasepriority dbo.tblcasewaitingfor dbo.tblbillingnames dbo.tblexptype dbo.tblfirm dbo.tblattorney dbo.tblclient dbo.tblinquiry dbo.tblcase dbo.tblbills dbo.tblactivity dbo.tblexpenses dbo.tblfundsrcvd dbo.tblsrvauth dbo.tblcaseresult dbo.tbl_scannedbillandcheck dbo.tblscanneddocument \
  -f scripts/migrate/out/export.sql
```

Twenty tables, in dependency order. `scripts/migrate/out/` is gitignored — the export never enters git.

---

## Part 2 — Cutover sequence

1. **Kris freezes Access.** No further edits in the legacy app from this moment. This is his only step.
2. **Get the latest `.bak`.** Today: the copy Kris has already placed for us. At go-live: pull the client's most recent nightly S3 backup ourselves. Either way, zero clicks from Kris.
3. **Restore and generate** — Part 1, steps 1.2 through 1.5. (1.1 only on a fresh machine.)
4. **Load:**
   ```sh
   node scripts/migrate/load.mjs scripts/migrate/out/export.sql
   ```
   Clears the 20 legacy tables and inserts the export in one transaction; any failure changes nothing. Prints rows inserted per table.

   Clearing is a row-level `DELETE`, not `TRUNCATE`: `profiles.personid` and `bank_transactions.expid`/`fndsid` reference three of the 20, so `TRUNCATE` would demand those tables be named too (or `CASCADE`). The load must never touch them, so it deletes instead — under `session_replication_role = replica`, which also keeps the `NOT VALID` FKs and the `audit` triggers quiet for that session only.

   **Timezone.** The load pins its session to UTC, so a naive SQL Server `datetime2` landing in a `timestamptz` column (only `tblcase.casestatlastupdated`) resolves to the same instant no matter which machine or shell runs it. The source values are Eastern wall-clock times from Access; if they should be read as Eastern rather than UTC, change the one `set time zone` line in `load.mjs` before cutover — the decision has to be made once, and the go-live re-run must use the same setting as any earlier trial.
5. **Verify:**
   ```sh
   node scripts/migrate/verify.mjs scripts/migrate/out/export.sql
   ```
   Compares source row counts and numeric-column sums against the database, and reports identity maxima, orphan rows per `NOT VALID` FK, denormalized-column drift, and the max length of every `ntext`-derived text column. Prints a Markdown table and writes it to `scripts/migrate/out/verify-<timestamp>.md`. **Exit 0 = counts and sums match.** Orphans and drift are informational and never fail the run.
6. **Seed logins:**
   ```sh
   node_modules/.bin/tsx scripts/migrate/seed-logins.mjs scripts/migrate/in/logins.json
   ```
   Creates the first Supabase auth users and their `profiles` rows from an array of `{ email, role: "admin" | "staff", personid }` (see `scripts/migrate/logins.example.json`). No passwords are set — users come in through the app's invite/reset flow. Idempotent on email. Put the real file at `scripts/migrate/in/logins.json`; that directory is gitignored. Run it under `tsx`, not `node`: it imports `createServerClient()` from `lib/db/client.ts`, so it also needs `NEXT_PUBLIC_SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` in the environment.
7. **Hand over.** Tell Kris the new app is live and Access stays frozen.

All three scripts read the target database from the `MIGRATE_DB_URL` environment variable and take no other flags (step 6 additionally needs the two Supabase variables above):

```sh
export MIGRATE_DB_URL="postgresql://…"   # the Supabase project's connection string
```

### If verify exits non-zero

**Stop.** Do not run step 6, do not hand over.

- Keep Access frozen or tell Kris to resume it — decide before anything else; the legacy app is the system of record until we hand over.
- Send `scripts/migrate/out/verify-<timestamp>.md` back with the mismatched tables.
- Fix the cause in the repo, then restart from Part 2 step 3 with a fresh `.bak`. `load.mjs` clears every legacy table (`delete from`, in reverse dependency order) and reloads inside one transaction, so a re-run is safe and leaves no duplicates. It does not `truncate`: `profiles` and `bank_transactions` reference three of these tables, and `truncate` would demand naming them or `cascade` — either one reaches beyond the legacy tables this lane owns.

---

## Part 3 — Human pre-steps and the go-live re-run

Two steps must happen once, by a person, before Part 2 can run:

1. **Rotate the `TechAssoc` SQL Server password** on the client's server. No repo code depends on it; it is out of scope for this lane and must simply be done before cutover.
2. **Create the Supabase project and set `MIGRATE_DB_URL`** to its Postgres connection string (see `~/os` memory `reference-bcns-ci-setup` for the standard secrets/vars set).

**The go-live re-run is identical to the first run in every step except one:** the `.bak` in step 2 of Part 2 comes from the client's nightly S3 backup instead of a manual copy. Same container, same restore, same `mssql-scripter` invocation, same three scripts, same `MIGRATE_DB_URL`. Nothing else changes, and Kris still installs and runs nothing.
