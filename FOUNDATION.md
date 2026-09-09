# Technology Associates — Foundation

These are the contracts every lane builds against; they land on `main` before any lane forks.

## Objective

Every shape a lane depends on — the 20 legacy tables in Postgres, the billing/time extension columns, profiles + RLS, audit, bank import staging, generated row types, the session helper — is frozen and fixture-backed on `main`.

Lane done when:
- Every table in the pinned listing exists in a fresh database with exactly those columns, types, and nullability, and every fixture row inserts
- `lib/db/types.ts` mirrors that database and `lib/auth/session.ts` exports the pinned signature; both typecheck against fixture rows
- `protected:` in MAP.md is locked to the contract + fixture + journey paths and `integration` is cut from the foundation commit
- All six journey tests exist in their own target and fail because the screen is missing, not because the harness is broken

## Config decisions (2026-09-08, Nate)

- Identifiers: legacy table/column names, lowercased, unquoted (`tblcase.caseid`). Postgres folds case; quoting every identifier is not worth it.
- Type map from the `.bak` (types decoded from `syscolpars`, LEGACY.md had names only): int/smallint as-is · nvarchar/ntext → `text` · `*Date` → `date`, `inqtime` → `time`, `casestatlastupdated` → `timestamptz` · money → `numeric(12,2)` · hours (real) → `numeric(9,3)` · `billingfactor` → `numeric(8,3)` · bit → `boolean default false` (nullable: SQL Server bits are nullable and legacy nulls are real data) · `SSMA_TimeStamp` dropped.
- Keys: PK on every table's first column; identity `by default` so migration keeps legacy IDs (`caseid` included — case numbers are assigned by hand in Access). FKs by naming convention, all `NOT VALID`: new rows enforced, legacy orphans tolerated. No FK from `tblinquiry.inqresultingcase` (smallint vs int) or `inqclient` (text).
- Roles: `admin` (Kris, Kalpna) manages logins + lookup lists; `staff` (Jon) everything else. Single tenant: RLS = any authenticated user reads/writes every table; `profiles` writes admin-only.
- Rate card + rate math: **out**. Bills are priced in the client's other service; v1 records hours and balances. Adding rates later is one additive migration.
- Journeys: Playwright, `pnpm test:journeys`, separate from `pnpm test` (node:test via tsx). Base URL `http://localhost:3100`.
- Inherited from template, named here: TS strict, Node 20, pnpm 11, Next 14 App Router.
- Local validation: no Docker on the dev Mac, so fixtures run against brew Postgres 17 (`FOUNDATION_PG_URL`, default `postgresql://localhost/ta_foundation`) with a stub `auth` schema + `anon`/`authenticated` roles applied first. `lib/db/types.ts` is generated from that database by `scripts/gen-db-types.mjs` (the Supabase CLI's `gen types` needs Docker).
- Supabase project does not exist yet. First lane to need it: `migration` (needs `SUPABASE_DB_URL` pooler URL — see `~/os` memory `reference-bcns-ci-setup`).

## Global rules

- Never edit an applied migration in place; a shape change is an amendment (new migration + fixture + re-run `/foundation`).
- Fixtures use invented data only. Never a real client, attorney, or check number.
- `lib/env.ts` stays the only `process.env` reader. `lib/db/client.ts` and `lib/auth/session.ts` take config from `getConfig()`.
- Context: `CLAUDE.md`, `LEGACY.md`, `MAP.md`.

## Not yet specified

- Storage path convention for case documents — revisit when lane `docs-reports` starts; not cross-lane.
- Where migration reads the `.bak` from (needs a SQL Server to restore; no Docker locally) — lane `migration` item 1.

## Out of scope

- Rate card, rate lookup, 2-year escalation — deferred with bill output; nothing in v1 prices hours.
- Bill PDF + email — client bills from another service (MAP.md).
- Backfilling `tblactivity.actbillid` for legacy billed rows — legacy rows keep `actbilled=true`, `actbillid null`; that pair is valid.

---

- task: Migration `supabase/migrations/0001_legacy_schema.sql` — the 20 legacy tables with the pinned columns, PKs, identity, and 26 `NOT VALID` FKs; plus `tests/foundation/local-supabase-stub.sql` (auth schema, `auth.uid()`, roles `anon`/`authenticated`/`service_role`) and the harness `tests/foundation/schema.test.mjs` that drops+creates `ta_foundation`, applies stub then every migration in order, and inserts `tests/foundation/fixtures/rows.ts`
  guardrails:
    - Column names and order exactly as listed; no renames, no "cleanup" of legacy names
    - Nullability exactly as listed (`?` = nullable); booleans are `not null default false` — **superseded by `0006` for 17 of the 19 bit columns, which are nullable in SQL Server; only `tblcase.billingalert` and `tblactivity.actbilled` are still `not null`. New boolean columns are not covered by this rule; take the nullability from the source.**
    - FKs are `not valid`; never validate them in this round
  done when:
    - Applying the migration to a fresh database creates exactly these tables (col:type, `?` = nullable, `id` = identity by default, first column = PK):
    - tblstates: state:text
    - tblbranches: branch:text
    - tblcasestatus: casestatus:text
    - tblcasepriority: priority:text
    - tblcasewaitingfor: waitingfor:text
    - tblbillingnames: personid:smallint, initials:text, billingfactor:numeric(8,3)
    - tblexptype: exptypeid:smallint, exptype:text, active:boolean
    - tblfirm: frmid:integer, frmname:text, frmaddress1:text?, frmaddress2:text?, frmcity:text?, frmstate:text?, frmzip:text?, frmphone:text?, frmfax:text?, frmemail:text?, frmpracticetype:text?, frmsize:text?, frmactive:text
    - tblattorney: attyid:integer, attyfirmid:integer, attytitle:text?, attyfirstname:text, attymiddlename:text?, attylastname:text, attysuffix:text?, attyesq:boolean, attyphone:text?, attyemail:text?, attycellphone:text?
    - tblclient: clientid:integer, clienttitle:text?, clientfirstname:text?, clientlastname:text?, clientphone:text?, clientnotes:text?
    - tblinquiry: id:integer, inqdate:date, inqtime:time?, inqattyid:integer?, inqsubject:text?, inqlocation:text?, tabranch:text?, inqrefferredby:text?, inqresultingcase:smallint?, inqcallertitle:text?, inqcallername:text?, inqattyname:text?, inqfirm:text?, inqfirmlocation:text?, inqaccidentlocation:text?, inqdescription:text?, inqhowheardaboutus:text?, inqclient:text?, inqphonenumber:text?, inqaltphonenumber:text?, inqfaxnumber:text?, inqemail:text?, inqpreviouscase:text?, inqreceptionist:text?, inqengineer:text?, inqcaption:text?, sentbranch:text?, sentfee:boolean, sentchecklist:boolean, sentllb:boolean, sentkjs:boolean, sentiuo:boolean, sentiuobio:boolean, sentoren:boolean, sentlarry:boolean, sentcoppolino:boolean, sentother1:boolean, sentother2:boolean, sentother1name:text?, sentother2name:text?, sentinfo1:text?, sentinfo2:text?, sentinfo3:text?
    - tblcase: caseid:integer, caseatty:integer, casetitle:text, casecaption:text?, casesubject:text?, caseclient:integer, tabranch:text, status:text, casenotes:text?, casestartdate:date, caseenddate:date?, casestatpriority:text?, casestatbriefdescription:text?, casestatdescription:text?, casestatpointman:text?, casestatduedate:date?, casestatwaitingfor:text?, casestatlastupdated:timestamptz?, caseinquiry:integer?, caseattyreference:text?, casestatsubpriority:integer?, casestatduedatedescription:text?, numunpaidbills:integer?, numunapprovedsa:integer?, otherexperts:text?, numscannedfeeschedule:integer?, billingalert:boolean, billingcc:text?, casestatharddeadline:boolean, casestatusharddeadline:boolean
    - tblbills: billid:integer, billcaseid:integer, billdate:date, billhours:numeric(8,2), billbalance:numeric(12,2), billreports:smallint?, billfilename:text?, billnotice:text, billpaiddate:date?, billestimate:boolean, billpriority:integer?, billcomments:text?, billsecondnoticedate:date?, billfinalnoticedate:date?
    - tblactivity: actid:integer, actcaseid:integer, actdate:date, actdescription:text, acthrs:numeric(8,2), actwho:smallint?, actbilled:boolean
    - tblexpenses: expid:integer, expcaseid:integer?, expbillid:integer?, expdate:date, expdscr:text, expchecknum:integer, exptype:smallint?, expbranch:text?, expamount:numeric(12,2), expreason:text?, expinit:smallint?, expclearedbank:boolean, expdatecleared:date?, expbankaccount:text?, expclearingnotes:text?, exp_scanned_check_number:integer?, exp_notcountedinprofit:numeric(12,2)?
    - tblfundsrcvd: fndsid:integer, fndscaseid:integer?, fndsdate:date, fndspmt:numeric(12,2), fndspayee:text?, fndssource:text?, fndsdesc:text?, fndsbranch:text, fndssafilename:text?, fndsbillfilename:text?, fndscomment:text?, fndstype:text?, fndsclearedbank:boolean, fndsdatecleared:date?, fndsbankaccount:text?, fndsclearingnotes:text?
    - tblsrvauth: srvauthid:integer, srvauthcaseid:integer, srvauthdate:date, srvauthhours:numeric(8,2), srvauthfile:text?, srvauthstatus:text, srvdateapproved:date?, srvadvance:numeric(12,2)?, srvauthnotes:text?
    - tblcaseresult: rsltid:integer, rsltcaseid:integer, rsltdate:date?, rslttype:text?, rsltsatisfaction:text?
    - tbl_scannedbillandcheck: id_number:integer, check_number:integer?, check_date:date?, description:text?, long_description:text?, scan_filename:text?
    - tblscanneddocument: id:integer, caseid:integer?, expenseid:integer?, incomeid:integer?, inquiryid:integer?, dateadded:date?, type:text?, description:text?, filename:text?, billid:integer?, servauthid:integer?
    - FKs (`not valid`): tblexpenses.expcaseid→tblcase, .expbillid→tblbills, .exptype→tblexptype, .expinit→tblbillingnames; tblbills.billcaseid→tblcase; tblfundsrcvd.fndscaseid→tblcase; tblattorney.attyfirmid→tblfirm; tblinquiry.inqattyid→tblattorney; tblsrvauth.srvauthcaseid→tblcase; tblactivity.actcaseid→tblcase, .actwho→tblbillingnames; tblcaseresult.rsltcaseid→tblcase; tblcase.caseatty→tblattorney, .caseclient→tblclient, .caseinquiry→tblinquiry, .tabranch→tblbranches, .status→tblcasestatus, .casestatpriority→tblcasepriority, .casestatwaitingfor→tblcasewaitingfor; tblfirm.frmstate→tblstates; tblscanneddocument.caseid/expenseid/incomeid/inquiryid/billid/servauthid → tblcase/tblexpenses/tblfundsrcvd/tblinquiry/tblbills/tblsrvauth
    - `pnpm test:foundation` inserts one fixture row per table (FK-safe order) and passes; inserting a new tblexpenses row with an unknown expcaseid fails with a foreign-key violation
    - Inserting a tblcase row with explicit `caseid = 90001` succeeds and the next identity value does not collide (`setval` handled by the harness, documented for lane migration)
  status: done
  amended-by: `0006_trial_load_fixes.sql` — 17 bit columns lose `not null`, the three hours columns become `numeric(9,3)`, and phantom `tblcase.casestatusharddeadline` is dropped. The shapes above describe 0001 as applied, not the current schema.

- task: Migration `supabase/migrations/0002_billing_time_columns.sql` — `tblbills.billtype text null check (billtype in ('blank','timesheet','depoprep','depo','trial','retainer'))`, `tblbills.supersedesbillid integer null references tblbills(billid)`, `tblactivity.actbillid integer null references tblbills(billid)`, and `check (actbillid is null or actbilled)`; fixture rows in `rows.ts` for a typed bill, a revision, a billed activity
  guardrails:
    - Additive only; 0001 is not edited
    - Legacy pair (`actbilled=true`, `actbillid=null`) stays valid
  done when:
    - `billtype='invoice'` is rejected by the check constraint; the six listed values insert
    - A tblactivity row with `actbillid` set and `actbilled=false` is rejected; `actbillid` set + `actbilled=true` inserts; unbilled is defined as `actbilled=false and actbillid is null`
    - A bill with `supersedesbillid` pointing at an existing bill inserts; pointing at 0 fails
  status: done

- task: Migration `supabase/migrations/0003_profiles_rls.sql` — `profiles(id uuid primary key references auth.users(id) on delete cascade, email text not null, role text not null check (role in ('admin','staff')), personid smallint null references tblbillingnames(personid), createdat timestamptz not null default now())`; enable RLS on every public table; policy `authenticated_all` (`for all to authenticated using (true) with check (true)`) on every table except profiles; on profiles: select for authenticated, insert/update/delete only when `exists (select 1 from profiles p where p.id = auth.uid() and p.role='admin')`
  guardrails:
    - No per-row ownership policies; single tenant
    - `anon` gets nothing
  done when:
    - After all migrations, `pg_policies` shows `authenticated_all` on all 21 tables other than profiles and audit_log (20 legacy + bank_transactions) and RLS is enabled on every public table
    - `role='owner'` is rejected; `personid` may be null
    - With `set role anon`, `select count(*) from tblcase` returns 0 rows or permission denied
  status: done
  parallel-group: a

- task: Migration `supabase/migrations/0004_bank_transactions.sql` — `bank_transactions(id bigint generated always as identity primary key, bankaccount text not null, postedon date not null, amount numeric(12,2) not null, description text not null, expid integer null references tblexpenses(expid), fndsid integer null references tblfundsrcvd(fndsid), importedat timestamptz not null default now(), unique (bankaccount, postedon, amount, description))`; RLS + `authenticated_all` policy; fixture row
  guardrails:
    - Staging table only; never a source of truth for the ledger
  done when:
    - Re-inserting the same (bankaccount, postedon, amount, description) fails with a unique violation
    - A row may have both expid and fndsid null; expid pointing at a missing expense fails
  status: done
  parallel-group: a

- task: Migration `supabase/migrations/0005_audit.sql` — `audit_log(id bigint generated always as identity primary key, tablename text not null, rowid text not null, op text not null check (op in ('INSERT','UPDATE','DELETE')), olddata jsonb null, newdata jsonb null, actor uuid null, at timestamptz not null default now())`; function `audit_row()` (security definer, `actor = auth.uid()`, rowid = the PK column value as text via `to_jsonb(row)->>pkcol`); trigger `audit` after insert/update/delete for each row on every public table except audit_log; RLS on audit_log with select for authenticated only
  guardrails:
    - Trigger never blocks a write; a failure inside `audit_row()` is a bug, not a policy
    - No policy allows inserting into audit_log directly
  done when:
    - Insert, update, delete of one tblexpenses fixture row produces three audit_log rows with tablename='tblexpenses', rowid = the expid, and olddata/newdata set as (null,row), (row,row), (row,null)
    - Every public table except audit_log has a trigger named `audit` (`pg_trigger`)
    - `insert into audit_log` as `authenticated` is denied
  status: done

- task: `lib/db/types.ts` generated by `pnpm db:types` (`node scripts/gen-db-types.mjs > lib/db/types.ts` — reads `information_schema` over `FOUNDATION_PG_URL`; the Supabase CLI's `gen types` needs Docker even with `--db-url`, which this machine doesn't have), `lib/db/client.ts` exporting `createServerClient(): SupabaseClient<Database>` (service-role, from `getConfig()`; throws `DbNotConfiguredError` when url or key is missing) and `Tables<'tblcase'>`-style helpers re-exported; `tests/foundation/fixtures/rows.ts` typed as `Database['public']['Tables'][T]['Insert']`; `tsconfig.foundation.json` including `lib/**` + `tests/foundation/**`; add `@supabase/supabase-js`
  guardrails:
    - `lib/db/types.ts` is generated, never hand-edited; regenerate after any migration
    - No `process.env` outside `lib/env.ts`
  done when:
    - `pnpm db:types` against the foundation database produces a file whose `Tables` keys are exactly the 23 tables (20 legacy, profiles, bank_transactions, audit_log) — no diff after a second run
    - `pnpm typecheck` and `pnpm typecheck:foundation` pass with every fixture row typed against its table's `Insert`; changing `expamount` to a string in a fixture fails typecheck
    - `createServerClient()` with no env set throws `DbNotConfiguredError`; app still builds with no env
  status: done

- task: `lib/auth/session.ts` — `export type Role = 'admin' | 'staff'`; `export type Session = { userId: string; email: string; role: Role; personId: number | null }`; `getSession(client?): Promise<Session | null>` (Supabase auth user joined to `profiles`; no user or no profiles row → null); `requireSession(role?: Role, client?): Promise<Session>` (null → `redirect('/login')`; `role='admin'` requested and session role is staff → throws `ForbiddenError`); `export class ForbiddenError extends Error`; add `@supabase/ssr`, cookie-based client in `lib/auth/client.ts`
  guardrails:
    - Never returns a session for a user without a profiles row — an invite that hasn't been granted a role is not a login
    - No role other than the two literals; no permission tables
  done when:
    - `tests/foundation/session.test.mjs` with an injected fake client: no auth user → `getSession()` is null; user with profile `{role:'staff', personid: 2}` → `{ userId, email, role:'staff', personId: 2 }`; user without profile → null
    - `requireSession()` with no session calls `redirect('/login')` exactly once; `requireSession('admin')` as staff throws `ForbiddenError`; as admin returns the session
    - `pnpm typecheck` passes; `app/api/health` unchanged
  status: done

- task: Journey target — add `@playwright/test` (dev), `playwright.config.ts` (testDir `tests/journeys`, baseURL from `BASE_URL` default `http://localhost:3100`, chromium only, no webServer block), script `test:journeys` = `playwright test`, `tests/journeys/README.md` stating these ship red and each going green is a lane finishing; `pnpm test` stays node:test only
  guardrails:
    - Journey files never import from `tests/*.test.mjs` unit suites
    - `pnpm test` must not pick up `tests/journeys`
  done when:
    - `pnpm test:journeys --list` lists exactly six spec files once the six items below land
    - `pnpm test` still runs only the three template suites plus `tests/foundation`
    - `pnpm install` passes on pnpm 11 (allowBuilds / minimumReleaseAge handled if tripped)
  status: done

- task: `tests/journeys/01-legacy-data.spec.ts` — logs in as a seeded staff user, opens `/cases/<legacy caseid>`, asserts the case page shows that case's bills, funds received, and expenses with the legacy totals from the fixture set
  guardrails:
    - Asserts on rendered text, never on database rows
  done when:
    - Spec exists in the journey target and fails today with a missing-element/404 assertion, not a harness error
    - Journey text in MAP.md `journeys:` entry 1 is quoted in the test title
  status: done
  parallel-group: j

- task: `tests/journeys/02-inquiry-to-case.spec.ts` — receptionist creates an inquiry at `/inquiries/new`; engineer converts it at `/inquiries/<id>` → new case with firm, attorney, client attached; case page shows all three and `caseinquiry` links back
  guardrails:
    - Asserts on rendered text, never on database rows
  done when:
    - Spec exists in the journey target and fails today with a missing-element/404 assertion, not a harness error
    - MAP.md journey 2 quoted in the title
  status: done
  parallel-group: j

- task: `tests/journeys/03-time-to-bill.spec.ts` — two staff users each add a time entry on one case at `/time`; admin creates a timesheet bill at `/bills/new?case=<id>` from unbilled hours, enters balance; case page shows the bill balance and both entries marked billed
  guardrails:
    - Asserts on rendered text, never on database rows
  done when:
    - Spec exists in the journey target and fails today with a missing-element/404 assertion, not a harness error
    - MAP.md journey 3 quoted in the title
  status: done
  parallel-group: j

- task: `tests/journeys/04-funds-to-paid.spec.ts` — record funds at `/funds/new` against a bill; mark bill paid; case page unpaid-bill count decrements; second/final notice dates remain empty
  guardrails:
    - Asserts on rendered text, never on database rows
  done when:
    - Spec exists in the journey target and fails today with a missing-element/404 assertion, not a harness error
    - MAP.md journey 4 quoted in the title
  status: done
  parallel-group: j

- task: `tests/journeys/05-bank-import-to-ledger.spec.ts` — upload a Bank of America CSV at `/bank-review`, assign an expense type from a list that hides retired types (`active=false`), confirm; the expense appears on the case ledger at `/expenses?case=<id>` and clears against the bank account
  guardrails:
    - Asserts on rendered text, never on database rows
  done when:
    - Spec exists in the journey target and fails today with a missing-element/404 assertion, not a harness error
    - MAP.md journey 5 quoted in the title
  status: done
  parallel-group: j

- task: `tests/journeys/06-dashboard-reports.spec.ts` — admin opens `/dashboard`, sees due/overdue/waiting/unpaid sections ordered by priority; runs P&L, YearlyExpense, and accountant export at `/reports` for a date range and each returns a non-empty result
  guardrails:
    - Asserts on rendered text, never on database rows
  done when:
    - Spec exists in the journey target and fails today with a missing-element/404 assertion, not a harness error
    - MAP.md journey 6 quoted in the title
  status: done
  parallel-group: j
