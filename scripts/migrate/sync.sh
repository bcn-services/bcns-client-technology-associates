#!/usr/bin/env bash
# sync.sh — "Sync from Access": reload the 20 legacy tables from TA's newest nightly SQL Server
# backup. Called by .github/workflows/sync-legacy.yml and by the local dry run; same file both
# times. It is the runbook (scripts/migrate/README.md Part 1 + Part 2 steps 3-5) as one script.
#
# DANGER: this overwrites the legacy tables of whatever database MIGRATE_DB_URL points at.
#
# Env
#   MIGRATE_DB_URL   required. Target Postgres. Session pooler (5432) in prod: load sets session GUCs.
#   RUN_ID           required to be SET; digits = the sync_runs row to track, empty = no tracking.
#   S3_BUCKET        bucket holding the nightly 7z backups (newest object by LastModified wins)
#   S3_ENDPOINT      optional --endpoint-url (non-AWS S3, minio)
#   LOCAL_ARCHIVE    optional path to a .7z/.zip/.bak; skips S3
#   MSSQL_SCRIPTER   default "python3 -m mssqlscripter"
#   REQUIRE_LOCAL_DB=1  refuse unless MIGRATE_DB_URL's host is 127.0.0.1/localhost (rehearsals)
#   SYNC_WORK_BASE   parent of the temp work dir (default $RUNNER_TEMP or /tmp). Must be a path
#                    Docker can bind-mount (colima only shares $HOME and /tmp/colima).
# Never reads .env.local. Never echoes the SA password or the DB URL's password.
#   MAX_BACKUP_AGE_HOURS  default 48; refuse a backup older than this (set once, in the workflow env)
#   Freshness checks (older than the last succeeded run's backup_at, older than MAX_BACKUP_AGE_HOURS)
#   are skipped when RUN_ID is empty (rehearsal: no sync_runs history) or LOCAL_ARCHIVE is set.
# Needs bash >= 4: macOS /bin/bash is 3.2, where an unbound-variable abort after the EXIT trap exits 0.
# On a Mac use `brew install bash` and run this with that bash (the shebang resolves it via PATH).
if (( BASH_VERSINFO[0] < 4 )); then echo "sync: bash >= 4 required (this is $BASH_VERSION)" >&2; exit 2; fi
set -euo pipefail

cd "$(dirname "$0")/../.."

: "${MIGRATE_DB_URL:?MIGRATE_DB_URL is required}"
: "${RUN_ID?RUN_ID must be set (empty = no status tracking)}"
[[ -z "$RUN_ID" || "$RUN_ID" =~ ^[0-9]+$ ]] || { echo "sync: RUN_ID must be digits" >&2; exit 2; }
export MIGRATE_DB_URL

if [[ "${REQUIRE_LOCAL_DB:-}" == 1 ]]; then
  host=$(sed -E 's#^[a-z]+://([^@/]*@)?([^:/?]+).*#\2#' <<<"$MIGRATE_DB_URL")
  echo "sync: target $(sed -E 's#(://[^:/@]+):[^@]*@#\1:***@#' <<<"$MIGRATE_DB_URL")"
  case "$host" in
    127.0.0.1 | localhost) ;;
    *) echo "sync: REQUIRE_LOCAL_DB=1 but host is '$host' — refusing" >&2; exit 2 ;;
  esac
fi

STEP="start"          # on failure this name (never log content: it could be client data) lands in sync_runs.error
CONTAINER=""
WORK=""

# --- sync_runs bookkeeping (values via psql -v, never string-built) -------------------------------
mark_running() {
  [[ -n "$RUN_ID" ]] || return 0
  local url="" n
  [[ -z "${GITHUB_RUN_ID:-}" ]] || url="${GITHUB_SERVER_URL:-https://github.com}/${GITHUB_REPOSITORY:-}/actions/runs/$GITHUB_RUN_ID"
  n=$(psql -X -q -At -v ON_ERROR_STOP=1 -v id="$RUN_ID" -v url="$url" "$MIGRATE_DB_URL" <<'SQL'
with u as (
  update sync_runs set status = 'running', started_at = now(), run_url = nullif(:'url', '')
  where id = :'id'::bigint and status = 'queued' returning 1)
select count(*) from u;
SQL
  )
  [[ "$n" == 1 ]] || { echo "sync: sync_runs row $RUN_ID is not queued" >&2; return 1; }
}

mark_backup() { # key, LastModified (may be empty)
  [[ -n "$RUN_ID" ]] || return 0
  psql -X -q -v ON_ERROR_STOP=1 -v id="$RUN_ID" -v key="$1" -v at="$2" "$MIGRATE_DB_URL" <<'SQL'
update sync_runs set backup_key = :'key', backup_at = nullif(:'at', '')::timestamptz where id = :'id'::bigint;
SQL
}

mark_done() { # succeeded | failed, error text (may be empty)
  [[ -n "$RUN_ID" ]] || return 0
  psql -X -q -v ON_ERROR_STOP=1 -v id="$RUN_ID" -v st="$1" -v err="${2:-}" "$MIGRATE_DB_URL" <<'SQL'
update sync_runs set status = :'st', finished_at = now(), error = nullif(:'err', '')
where id = :'id'::bigint and status in ('queued', 'running');
SQL
}

on_exit() {
  local rc=$?
  trap - EXIT
  if [[ $rc -ne 0 ]]; then
    echo "sync: FAILED at step: $STEP" >&2
    mark_done failed "$STEP" || true
  fi
  [[ -z "$CONTAINER" ]] || docker rm -f "$CONTAINER" >/dev/null 2>&1 || true
  [[ -z "$WORK" ]] || rm -rf "$WORK"
  exit $rc
}
trap on_exit EXIT
trap 'exit 143' TERM INT   # a cancelled workflow still runs on_exit

# --- schema gate: every repo migration applied, and the newest ones agree -------------------------
STEP="schema gate"
repo_versions=$(for f in supabase/migrations/*.sql; do b=${f##*/}; echo "${b%%_*}"; done | LC_ALL=C sort)
db_versions=$(psql -X -q -At -v ON_ERROR_STOP=1 "$MIGRATE_DB_URL" -c "select version from supabase_migrations.schema_migrations" | LC_ALL=C sort)
missing=$(LC_ALL=C comm -23 <(echo "$repo_versions") <(echo "$db_versions") | tr '\n' ' ')
repo_max=$(tail -n 1 <<<"$repo_versions")
db_max=$(tail -n 1 <<<"$db_versions")
if [[ -n "${missing// /}" || "$repo_max" != "$db_max" ]]; then
  STEP="schema gate: repo at ${repo_max:-none}, database at ${db_max:-none}, unapplied: ${missing:-none}"
  exit 1
fi
echo "sync: schema gate ok (migrations through $repo_max)"

STEP="mark running"
mark_running

# --- pick and download the backup -----------------------------------------------------------------
STEP="prepare work dir"
WORK=$(mktemp -d "${SYNC_WORK_BASE:-${RUNNER_TEMP:-/tmp}}/sync.XXXXXX")
mkdir "$WORK/dl" "$WORK/x"

if [[ -n "${LOCAL_ARCHIVE:-}" ]]; then
  STEP="use local archive"
  ARCHIVE="$LOCAL_ARCHIVE"
  mark_backup "local:${ARCHIVE##*/}" ""
else
  STEP="find newest backup"
  [[ -n "${S3_BUCKET:-}" ]] || { echo "sync: S3_BUCKET is required" >&2; exit 1; }
  aws_ep=()
  if [[ -n "${S3_ENDPOINT:-}" ]]; then aws_ep=(--endpoint-url "$S3_ENDPOINT"); fi
  newest=$(aws s3api list-objects-v2 ${aws_ep[@]+"${aws_ep[@]}"} --bucket "$S3_BUCKET" \
    --query 'sort_by(Contents, &LastModified)[-1].[Key, LastModified]' --output text)
  IFS=$'\t' read -r key modified <<<"$newest"
  [[ -n "$key" && "$key" != None ]] || { echo "sync: no objects in the bucket" >&2; exit 1; }
  echo "sync: newest backup is '$key' ($modified)"
  if [[ -n "$RUN_ID" ]]; then
    STEP="check backup freshness"
    max_hours="${MAX_BACKUP_AGE_HOURS:-48}"
    [[ "$max_hours" =~ ^[0-9]+$ ]] || { echo "sync: MAX_BACKUP_AGE_HOURS must be digits" >&2; exit 2; }
    stale=$(psql -X -q -At -v ON_ERROR_STOP=1 -v mod="$modified" -v hrs="$max_hours" "$MIGRATE_DB_URL" <<'SQL'
select case
  when :'mod'::timestamptz < (select max(backup_at) from sync_runs where status = 'succeeded') then 'older than the last synced backup'
  when now() - :'mod'::timestamptz > make_interval(hours => :'hrs'::int) then 'older than the maximum age'
  else '' end;
SQL
    )
    if [[ -n "$stale" ]]; then
      STEP="backup is $stale (backup dated $modified)"
      exit 1
    fi
  fi
  STEP="download backup"
  ARCHIVE="$WORK/dl/archive"
  aws s3 cp ${aws_ep[@]+"${aws_ep[@]}"} --only-show-errors "s3://$S3_BUCKET/$key" "$ARCHIVE"
  mark_backup "$key" "$modified"
  ARCHIVE_NAME="$key"
fi

# --- extract: 7z archive, or a bare .bak ---------------------------------------------------------
STEP="extract backup"
ARCHIVE_NAME="${ARCHIVE_NAME:-${ARCHIVE##*/}}"
if [[ "$(tr '[:upper:]' '[:lower:]' <<<"$ARCHIVE_NAME")" == *.bak ]]; then
  cp "$ARCHIVE" "$WORK/x/restore.bak"
else
  SEVENZ=$(command -v 7z || command -v 7zz) || { echo "sync: neither 7z nor 7zz is installed" >&2; exit 1; }
  "$SEVENZ" x -y -bso0 -bsp0 -o"$WORK/x" "$ARCHIVE"
fi
bak_count=$(find "$WORK/x" -type f -iname '*.bak' | wc -l | tr -d ' ')
[[ "$bak_count" == 1 ]] || { echo "sync: expected exactly one .bak, found $bak_count" >&2; exit 1; }
bak=$(find "$WORK/x" -type f -iname '*.bak')
[[ "$bak" == "$WORK/x/restore.bak" ]] || mv "$bak" "$WORK/x/restore.bak"   # fixed name: nothing odd reaches T-SQL
rm -f "$WORK/dl/archive"

# --- restore into a throwaway SQL Server (runbook 1.2, 1.4) --------------------------------------
STEP="start sql server"
SA_PASSWORD="$(openssl rand -base64 24 | tr -d '/+=\n')Aa1!"
if [[ -n "${GITHUB_ACTIONS:-}" ]]; then echo "::add-mask::$SA_PASSWORD"; fi
export MSSQL_SA_PASSWORD="$SA_PASSWORD" SQLCMDPASSWORD="$SA_PASSWORD"   # -e NAME passes the value without putting it in argv
CONTAINER="ta-sync-mssql-$$"
docker run -d --name "$CONTAINER" --platform linux/amd64 \
  -e ACCEPT_EULA=Y -e MSSQL_SA_PASSWORD -p 127.0.0.1:1433:1433 -v "$WORK/x":/bak:ro \
  mcr.microsoft.com/mssql/server:2022-latest >/dev/null

sqlcmd() { docker exec -e SQLCMDPASSWORD "$CONTAINER" /opt/mssql-tools18/bin/sqlcmd -b -C -S localhost -U sa "$@"; }

STEP="wait for sql server"
for _ in $(seq 1 60); do
  if sqlcmd -Q "select 1" >/dev/null 2>&1; then ready=1; break; fi
  sleep 3
done
[[ "${ready:-}" == 1 ]] || { echo "sync: sql server never became ready" >&2; exit 1; }

STEP="read backup file list"
filelist=$(sqlcmd -h -1 -W -s"|" -Q "SET NOCOUNT ON; RESTORE FILELISTONLY FROM DISK = N'/bak/restore.bak'")
data_name=$(awk -F'|' 'NF >= 3 && $3 == "D" {print $1}' <<<"$filelist")
log_name=$(awk -F'|' 'NF >= 3 && $3 == "L" {print $1}' <<<"$filelist")
if [[ -z "$data_name" || -z "$log_name" || "$data_name$log_name" == *$'\n'* || "$data_name$log_name" == *"'"* ]]; then
  echo "sync: backup does not have exactly one data file and one log file" >&2; exit 1
fi

STEP="restore database"
sqlcmd -Q "RESTORE DATABASE TechAssoc FROM DISK = N'/bak/restore.bak' WITH \
  MOVE N'$data_name' TO N'/var/opt/mssql/data/TechAssoc.mdf', \
  MOVE N'$log_name' TO N'/var/opt/mssql/data/TechAssoc_log.ldf', REPLACE" >/dev/null

# --- source row counts (runbook 1.5) and the data-only export (runbook 1.6) ------------------------
STEP="count source rows"
read -r -d '' COUNTS_SQL <<'SQL' || true
SET NOCOUNT ON;
DECLARE @s nvarchar(max) = N'';
SELECT @s = @s + N' UNION ALL SELECT ''' + LOWER(name) + N''' AS tbl, COUNT_BIG(*) AS n FROM dbo.' + QUOTENAME(name)
FROM sys.tables WHERE LOWER(name) IN (
  'tblstates','tblbranches','tblcasestatus','tblcasepriority','tblcasewaitingfor',
  'tblbillingnames','tblexptype','tblfirm','tblattorney','tblclient',
  'tblinquiry','tblcase','tblbills','tblactivity','tblexpenses',
  'tblfundsrcvd','tblsrvauth','tblcaseresult','tbl_scannedbillandcheck','tblscanneddocument');
SET @s = STUFF(@s, 1, 11, N'') + N' ORDER BY tbl';
EXEC(@s);
SQL
sqlcmd -d TechAssoc -h -1 -W -s"|" -Q "$COUNTS_SQL" >"$WORK/source-counts.txt"
n_lines=$(wc -l <"$WORK/source-counts.txt" | tr -d ' ')
n_good=$(grep -Ec '^[a-z_]+\|[0-9]+$' "$WORK/source-counts.txt" || true)
[[ "$n_lines" == 20 && "$n_good" == 20 ]] || { echo "sync: source-counts has $n_lines lines ($n_good valid), expected 20" >&2; exit 1; }

STEP="script the export"
read -r -a SCRIPTER <<<"${MSSQL_SCRIPTER:-python3 -m mssqlscripter}"
PYTHONIOENCODING=utf8 "${SCRIPTER[@]}" -S localhost -d TechAssoc -U sa -P "$SA_PASSWORD" \
  --data-only --target-server-version vNext \
  --include-objects dbo.tblstates dbo.tblbranches dbo.tblcasestatus dbo.tblcasepriority dbo.tblcasewaitingfor dbo.tblbillingnames dbo.tblexptype dbo.tblfirm dbo.tblattorney dbo.tblclient dbo.tblinquiry dbo.tblcase dbo.tblbills dbo.tblactivity dbo.tblexpenses dbo.tblfundsrcvd dbo.tblsrvauth dbo.tblcaseresult dbo.tbl_scannedbillandcheck dbo.tblscanneddocument \
  -f "$WORK/export.sql" >/dev/null

# --- load, verify (unchanged scripts) -------------------------------------------------------------
STEP="load"
node scripts/migrate/load.mjs "$WORK/export.sql"

STEP="loaded but verify failed"
node scripts/migrate/verify.mjs "$WORK/export.sql" --source-counts="$WORK/source-counts.txt"

STEP="mark succeeded"
mark_done succeeded ""
STEP="done"
echo "sync: succeeded"
