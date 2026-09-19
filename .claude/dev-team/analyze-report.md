# Codebase Analysis
**Repo:** bcns-client-technology-associates
**Areas Analyzed:** house-query-module-shape, frozen-db-contract, reusable-domain-logic, page-server-component-conventions, test-conventions-and-execution, journey-06-acceptance
**Verified:** 2026-09-19

## Area: house-query-module-shape

### Relevant Files
- `lib/expenses/list.ts` (72 lines) — `listExpenses(db, filter)`, paging + money helpers
- `lib/cases/presets.ts` (192 lines) — case-list query functions, `all()` paging helper
- `lib/funds/case.ts` (34 lines) — `listCaseFunds`, `listBillChecks`, unpaged
- `lib/bills/rules.ts` (47 lines) — pure functions, no db access

### Exported Signatures (verbatim)
- `lib/expenses/list.ts:19` `export const parseCase = (raw: string | undefined): number | null`
- `lib/expenses/list.ts:22` `export const parseMonth = (raw: string | undefined): string | null`
- `lib/expenses/list.ts:25` `export function monthBounds(ym: string): [string, string]`
- `lib/expenses/list.ts:33` `export const toCents = (v: number | string): number`
- `lib/expenses/list.ts:35` `export function fmtCents(c: number): string`
- `lib/expenses/list.ts:41` `export async function listExpenses(db: Db, f: ExpenseFilter): Promise<ExpenseList>`
- `lib/cases/presets.ts:57` `export function normalizePointMan(v: string | undefined): string`
- `lib/cases/presets.ts:67` `export function workStatus(db: Db, pointMan: string, sort: WorkStatusSort): Promise<Result<WorkStatusRow>>`
- `lib/cases/presets.ts:104` `export function waitingFor(db: Db): Promise<Result<WaitingForRow>>`
- `lib/cases/presets.ts:126` `export function otherExperts(db: Db, term: string): Promise<Result<OtherExpertsRow>>`
- `lib/cases/presets.ts:143` `export function activityCutoff(today: string): string`
- `lib/cases/presets.ts:150` `export function firmToday(now: Date): string`
- `lib/cases/presets.ts:161` `export function recentActivity(db: Db, today: string): Promise<Result<ActivityRow>>`
- `lib/cases/presets.ts:190` `export function param(v: string | string[] | undefined): string`
- `lib/funds/case.ts:9` `export async function listCaseFunds(db: Db, caseId: number): Promise<CaseFunds>`
- `lib/funds/case.ts:28` `export async function listBillChecks(db: Db, billids: number[]): Promise<BillCheck[]>`
- `lib/bills/rules.ts:25` `export const isOpen = (notice: string): boolean`
- `lib/bills/rules.ts:29` `export const nextNotice = (notice: string): string | null`
- `lib/bills/rules.ts:32` `export const billFileName = (caseId: number, attyLastName: string, billdate: string, n: number): string`
- `lib/bills/rules.ts:35-36` `export const lastNoticeDate = (bill: BillDates): string => bill.billfinalnoticedate ?? bill.billsecondnoticedate ?? bill.billdate;`
- `lib/bills/rules.ts:44` `export const daysSinceNotice = (bill: BillDates, today: string): number`
- `lib/bills/rules.ts:46-47` `export const isDue = (bill: BillDates, today: string): boolean => isOpen(bill.billnotice) && daysSinceNotice(bill, today) >= BILL_DUE_DAYS;`

### Db type
- `lib/expenses/list.ts:2` and `lib/funds/case.ts:2` both: `import type { Db } from "@/lib/time/entries";` (shared structural type, source of truth is `lib/time/entries.ts`, not directly read here — not verified beyond the import line)
- `lib/cases/presets.ts:6-7,10` defines its own local (non-exported) `type Db = SupabaseClient<Database>;` from `import type { SupabaseClient } from "@supabase/supabase-js";` + `import type { Database } from "@/lib/db/types";` — i.e. presets.ts does NOT reuse the `@/lib/time/entries` `Db` alias, it has a parallel nominal-equivalent definition.
- `lib/bills/rules.ts` has no `Db` type — pure functions only, no db access.

### requireSession()
- Not called inside any of the 4 lib modules. Defined at `lib/auth/session.ts:37` (`export async function requireSession(...)`), imported `import { requireSession } from "@/lib/auth/session";` and called at the **page** level, run concurrently with the query via `Promise.all`, e.g. `app/expenses/page.tsx:2,18`:
  ```
  // Session check and the read run together (saves the auth round trip); nothing renders unless requireSession resolves.
  const [, { rows, total }] = await Promise.all([requireSession(), listExpenses(createServerClient() as unknown as Db, { caseId, month })]);
  ```
  Pattern to copy: session check + query fired together via `Promise.all`, never awaited sequentially before the query.

### Paging idiom
Two distinct idioms exist — pick one per new module, do not invent a third:

**A. `lib/expenses/list.ts` — count-first, parallel pages.** `PAGE = 1000` (line 16). Page helper uses `.range(from, from + PAGE - 1)` (line 49) with `count: "exact"` on the first page (line 43). Then:
```typescript
const [types, head] = await Promise.all([db.from("tblexptype").select("exptypeid, exptype"), page(0, true)]);
...
const rest: number[] = [];
for (let from = PAGE; from < (head.count ?? 0); from += PAGE) rest.push(from);
const raw: any[] = [head, ...(await Promise.all(rest.map((from) => page(from, false))))].flatMap((p) => p.data ?? []);
```
Pages fetched **in parallel** via `Promise.all` over precomputed offsets, after one exact-count page 0.

**B. `lib/cases/presets.ts:17-28` — no count, sequential, verbatim `all()` helper:**
```typescript
async function all<T>(build: () => any, table: string): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await build().range(from, from + 999);
    if (error) {
      console.error(`case presets: ${table}: ${error.message}`);
      throw new QueryError();
    }
    out.push(...(data as T[]));
    if (data.length < 1000) return out;
  }
}
```
No initial COUNT; pages fetched **sequentially** (awaited one at a time in a `for` loop), stops when a page returns fewer than 1000 rows.

- `lib/funds/case.ts` has no paging: line 8 comment `// ponytail: one unpaged read (PostgREST caps at 1000 rows) — page like listExpenses if a case ever nears that`.

### Money helpers
- Both defined and exported from `lib/expenses/list.ts`: `toCents` (line 33), `fmtCents` (line 35).
- Re-exported/imported elsewhere via `lib/funds/case.ts:3` `import { fmtCents, toCents } from "@/lib/expenses/list";` — this is the canonical import path for any new module needing cent math.
- `lib/cases/presets.ts` and `lib/bills/rules.ts` neither define nor import them.

### Patterns to Follow
- Reuse `toCents`/`fmtCents` from `@/lib/expenses/list` for any money math in this lane — do not reimplement.
- For a new report query module, prefer idiom A (count-first + parallel pages) when the table can return an exact count cheaply; use idiom B (`all()`-style sequential loop) when composing multiple dependent unpaged-count reads, matching whichever sibling module the new code sits closest to.
- `requireSession()` is a page-level concern, run via `Promise.all` alongside the first query — not inside lib query functions.

### Risks
- Two incompatible `Db` type sources in play (`@/lib/time/entries` vs local `SupabaseClient<Database>` in presets.ts) — confirm which one a new module's siblings use before choosing.
- `lib/funds/case.ts` is unpaged by design; a reports query that aggregates funds across many cases must not copy that pattern without adding paging.

---

## Area: frozen-db-contract

### Relevant Files
- `lib/db/types.ts` (906 lines) — generated (`// Generated by scripts/gen-db-types.mjs — do not edit. Regenerate with 'pnpm db:types'.`, line 1)
- `lib/db/client.ts` (25 lines) — `createServerClient()`, `Tables<T>` helper
- `supabase/migrations/0001_legacy_schema.sql`, `0006_trial_load_fixes.sql` — ground-truth Postgres column types (types.ts collapses all numeric-ish types to TS `number`, so migrations are the only source for exact Postgres type)

### Tables<T> helper
`lib/db/client.ts:10`:
```typescript
export type Tables<T extends keyof Database["public"]["Tables"]> = Database["public"]["Tables"][T]["Row"];
```
`lib/db/client.ts:7,9`: `import type { Database } from "./types";` and re-exports `export type { Database } from "./types";`. `Inserts`/`Updates` siblings also defined lines 11-12. `createServerClient()` at lines 21-25 returns `SupabaseClient<Database>`, configured via `getConfig()` from `lib/env.ts`.

### Column lists (TS Row types, from lib/db/types.ts)
- **tblexpenses** (types.ts:470-488): `expid: number; expcaseid: number | null; expbillid: number | null; expdate: string; expdscr: string; expchecknum: number; exptype: number | null; expbranch: string | null; expamount: number; expreason: string | null; expinit: number | null; expclearedbank: boolean | null; expdatecleared: string | null; expbankaccount: string | null; expclearingnotes: string | null; exp_scanned_check_number: number | null; exp_notcountedinprofit: number | null`
- **tblfundsrcvd** (types.ts:597-614): `fndsid: number; fndscaseid: number | null; fndsdate: string; fndspmt: number; fndspayee: string | null; fndssource: string | null; fndsdesc: string | null; fndsbranch: string; fndssafilename: string | null; fndsbillfilename: string | null; fndscomment: string | null; fndstype: string | null; fndsclearedbank: boolean | null; fndsdatecleared: string | null; fndsbankaccount: string | null; fndsclearingnotes: string | null; fndsbillid: number | null`
- **tblexptype** (types.ts:531-533): `exptypeid: number; exptype: string; active: boolean | null`
- **tblbills** (types.ts:219-235): `billid: number; billcaseid: number; billdate: string; billhours: number; billbalance: number; billreports: number | null; billfilename: string | null; billnotice: string; billpaiddate: string | null; billestimate: boolean | null; billpriority: number | null; billcomments: string | null; billsecondnoticedate: string | null; billfinalnoticedate: string | null; billtype: string | null; supersedesbillid: number | null`
- **tblcase** (types.ts:288-317): `caseid: number; caseatty: number; casetitle: string; casecaption: string | null; casesubject: string | null; caseclient: number; tabranch: string; status: string; casenotes: string | null; casestartdate: string; caseenddate: string | null; casestatpriority: string | null; casestatbriefdescription: string | null; casestatdescription: string | null; casestatpointman: string | null; casestatduedate: string | null; casestatwaitingfor: string | null; casestatlastupdated: string | null; caseinquiry: number | null; caseattyreference: string | null; casestatsubpriority: number | null; casestatduedatedescription: string | null; numunpaidbills: number | null; numunapprovedsa: number | null; otherexperts: string | null; numscannedfeeschedule: number | null; billingalert: boolean; billingcc: string | null; casestatharddeadline: boolean | null`
- **tblactivity** (types.ts:126-134): `actid: number; actcaseid: number; actdate: string; actdescription: string; acthrs: number; actwho: number | null; actbilled: boolean; actbillid: number | null`
- **tblscanneddocument** (types.ts:795-806): `id: number; caseid: number | null; expenseid: number | null; incomeid: number | null; inquiryid: number | null; dateadded: string | null; type: string | null; description: string | null; filename: string | null; billid: number | null; servauthid: number | null`

### Postgres types (ground truth, `supabase/migrations/0001_legacy_schema.sql`; `gen-db-types.mjs:13` collapses `int|numeric|real|double` all to TS `number`, so TS alone can't distinguish — migrations checked directly)
- Money columns, all `numeric(_,_) not null` unless noted:
  - `billhours numeric(8,2) not null` (migrations:169)
  - `billbalance numeric(12,2) not null` (migrations:170)
  - `expamount numeric(12,2) not null` (migrations:203)
  - `exp_notcountedinprofit numeric(12,2)` — **nullable** numeric, no `not null` (migrations:211)
  - `fndspmt numeric(12,2) not null` (migrations:219)
- `expcaseid integer` — **nullable** (no `not null`, migrations ~line 200) → matches `expcaseid: number | null`
- `fndscaseid integer` — **nullable** (no `not null`, migrations ~line 217) → matches `fndscaseid: number | null`
- `tblexptype.active`: originally `boolean not null default false` (migrations:38), then `supabase/migrations/0006_trial_load_fixes.sql:8`: `alter table tblexptype alter column active drop not null;` — now **nullable boolean**, matching `active: boolean | null`.
- `exp_notcountedinprofit`: type is `numeric(12,2)`, **nullable** — it is a dollar amount, not a flag/boolean (despite the name reading like a flag).

### Patterns to Follow
- Never hand-edit `lib/db/types.ts` — regenerate via `pnpm db:types` if schema changes.
- Use `Tables<"tblexpenses">` etc. (from `@/lib/db/client`) as the row type in new report query modules rather than re-declaring row shapes.
- Treat `exp_notcountedinprofit` as a nullable currency amount to subtract/exclude from profit calcs, not a boolean toggle — a report doing profit math must null-coalesce it (`?? 0`) before use.

### Risks
- `exp_notcountedinprofit`'s name strongly suggests boolean but it is `numeric | null` — a P&L/profit report is explicitly in scope for this lane (journey 06 tests a "P&L / profit" report) and getting this column's semantics wrong will silently corrupt that report's numbers.
- `expcaseid`/`fndscaseid` nullability means any per-case aggregation (funds/expenses grouped by case) must filter or handle null case IDs explicitly.
- `active` on `tblexptype` is nullable, not just boolean — `active === true` vs `active ?? false` distinction matters for filtering active types in a report.

---

## Area: reusable-domain-logic

### Relevant Files
- `lib/bills/rules.ts` — `isDue`, `lastNoticeDate`, `OPEN_NOTICES`
- `lib/cases/presets.ts` — `waitingFor`, `workStatus`

### isDue()
`lib/bills/rules.ts:46-47`:
```typescript
export const isDue = (bill: BillDates, today: string): boolean =>
  isOpen(bill.billnotice) && daysSinceNotice(bill, today) >= BILL_DUE_DAYS;
```
Call sites: `lib/bills/list.ts:2` (import), `lib/bills/list.ts:38` (`due: isDue(b, today),`).

### lastNoticeDate()
`lib/bills/rules.ts:35-36`:
```typescript
export const lastNoticeDate = (bill: BillDates): string =>
  bill.billfinalnoticedate ?? bill.billsecondnoticedate ?? bill.billdate;
```
Call sites: internal use in `daysSinceNotice()` (`lib/bills/rules.ts:44`); `lib/bills/list.ts:2` (import), `lib/bills/list.ts:40` (`lastNotice: lastNoticeDate(b),`).

### OPEN_NOTICES
`lib/bills/rules.ts:8`:
```typescript
export const OPEN_NOTICES: ReadonlySet<string> = new Set(["1st", "2nd", "Final", "Partial Payment", "Deadbeat"]);
```
Call sites: internal use in `isOpen()` (`lib/bills/rules.ts:25`); `lib/bills/list.ts:2` (import), `lib/bills/list.ts:30` (`const STAGES = [...OPEN_NOTICES];`), `lib/bills/list.ts:34` (`.in("billnotice", [...OPEN_NOTICES])`).

### waitingFor()
`lib/cases/presets.ts:104-119`:
```typescript
export function waitingFor(db: Db): Promise<Result<WaitingForRow>> {
  const d = db as unknown as Loose;
  return guard("waiting-for cases", async () => {
    const cases = await all<Omit<WaitingForRow, "funds">>(() => d.from("tblcase")
      .select("caseid, casetitle, casestatwaitingfor, casestartdate, casestatduedate, casestatdescription, casestatduedatedescription")
      .or(WAITING_FOR.map((v) => orElement({ source: "case", column: "casestatwaitingfor", op: "ilike", value: escapeLike(v) })).join(","))
      .order("caseid"), "tblcase");
    if (!cases.length) return [];
    const cents = new Map<number, number>();
    // ponytail: one .in() with every waiting case id — fine for tens of cases; chunk if it reaches URL limits.
    const funds = await all<{ fndscaseid: number; fndspmt: number | string }>(() => d.from("tblfundsrcvd")
      .select("fndsid, fndscaseid, fndspmt").in("fndscaseid", cases.map((c) => c.caseid)).order("fndsid"), "tblfundsrcvd");
    for (const f of funds) cents.set(f.fndscaseid, (cents.get(f.fndscaseid) ?? 0) + Math.round(Number(f.fndspmt) * 100));
    return cases.map((c) => ({ ...c, funds: (cents.get(c.caseid) ?? 0) / 100 }));
  });
}
```
Call sites: `app/cases/lists/waiting-for/page.tsx` (import + `const [result] = await Promise.all([waitingFor(db)]);`).

### workStatus()
`lib/cases/presets.ts:67-87`:
```typescript
export function workStatus(db: Db, pointMan: string, sort: WorkStatusSort): Promise<Result<WorkStatusRow>> {
  const d = db as unknown as Loose;
  const pm = normalizePointMan(pointMan);
  return guard("work status", async () => {
    const rows = await all<WorkStatusRow>(() => {
      let q = d.from("tblcase")
        .select("caseid, casetitle, casestatpriority, casestatpointman, casestatduedate, casestatduedatedescription, casestatdescription, casestatwaitingfor")
        .not("casestatpriority", "is", null)
        .not("casestatpriority", "like", "%9%");
      // Blank target: legacy Like "**" matches every non-null point man, plus nulls = all rows.
      if (pm) q = q.or(`${orElement({ source: "case", column: "casestatpointman", op: "ilike", value: `%${escapeLike(pm)}%` })},casestatpointman.is.null`);
      return q.order("caseid");
    }, "tblcase");
    // Sorted here, not in SQL: PostgREST can't order by lower(text) or by "is null".
    // ponytail: whole matching set in memory — fine for active cases (hundreds); paginate if it grows.
    return rows.sort(sort === "priority"
      ? (a, b) => cmp((a.casestatpriority ?? "").toLowerCase(), (b.casestatpriority ?? "").toLowerCase()) || a.caseid - b.caseid
      : (a, b) => cmp(a.casestatduedate == null ? 1 : 0, b.casestatduedate == null ? 1 : 0)
        || cmp(a.casestatduedate ?? "", b.casestatduedate ?? "") || a.caseid - b.caseid);
  });
}
```
**Legacy priority filter (verbatim, line 75):** `.not("casestatpriority", "like", "%9%");` — excludes any case whose `casestatpriority` contains the substring `"9"` anywhere (legacy convention, not a numeric comparison).
Call sites: `app/cases/lists/work-status/page.tsx` and `app/cases/lists/work-status/print/page.tsx`, both `const [result] = await Promise.all([workStatus(db, pm, sort)]);`.

### Patterns to Follow
- A report needing "due"/"overdue" bill logic must call `isDue()`/`lastNoticeDate()`/`OPEN_NOTICES` from `lib/bills/rules.ts`, not recompute notice-stage logic inline.
- A report needing "waiting for" or "work status" case logic must call `waitingFor()`/`workStatus()` from `lib/cases/presets.ts` verbatim — including the `casestatpriority not like '%9%'` legacy exclusion — not re-derive its own case-priority filter.
- Sorting/aggregation done client-side in JS after fetch (not pushed to SQL) is the house pattern when Postgrest can't express the ordering (case-insensitive, nulls-last) — follow this rather than trying to force it into `.order()`.

### Risks
- `workStatus()`'s `%9%` filter is a legacy substring match with no documented meaning beyond "exclude priority values containing a 9" — reproducing it verbatim (not reinventing an equivalent) is required for correctness parity with the existing UI.
- `waitingFor()` money aggregation manually round-trips through cents (`Math.round(Number(f.fndspmt) * 100)`) rather than using `toCents`/`fmtCents` from `lib/expenses/list.ts` — inconsistent with the money-helper convention in Area 1; a new reports module should still prefer the shared helpers unless matching this function's own output shape exactly.

---

## Area: page-server-component-conventions

### Relevant Files
- `app/expenses/page.tsx` — client acquisition, searchParams, table markup, data-testid, error surfacing (via `app/expenses/expense-form.tsx`, `app/expenses/new/page.tsx`)
- `app/bills/page.tsx` — client acquisition (no searchParams)
- `app/cases/page.tsx` — client acquisition, typed searchParams
- `lib/auth/sections.ts` — nav/section registry

### Server client acquisition (verbatim)
- `app/expenses/page.tsx:3,18`: `import { createServerClient } from "@/lib/db/client";` ... `createServerClient() as unknown as Db`
- `app/bills/page.tsx:1,10`: `import { createServerClient } from "@/lib/db/client";` ... `db: createServerClient() as unknown as Db`
- `app/cases/page.tsx:3,13`: `import { createServerClient } from "@/lib/db/client";` ... `const db = createServerClient();`
- Import path is always `@/lib/db/client`; the cast `as unknown as Db` (to the `@/lib/time/entries` structural `Db` type) appears at call sites that pass into `Db`-typed lib functions.

### searchParams reading
- `app/expenses/page.tsx:10,14-15`:
  ```typescript
  type Params = Record<string, string | string[] | undefined>;
  export default async function ExpensesPage({ searchParams }: { searchParams: Params }) {
    const caseId = parseCase(first(searchParams.case));
  ```
- `app/cases/page.tsx:9,11,14`:
  ```typescript
  type Params = { q?: string; list?: string; page?: string };
  export default async function CasesPage({ searchParams }: { searchParams: Params }) {
    const q = (searchParams.q ?? "").trim();
  ```
- `app/bills/page.tsx:9`: no searchParams — `export default async function BillsPage()`.
- Both loose (`Record<string,...>`) and narrow (explicit optional-field) `Params` types are in use; pick whichever matches how many distinct query params the new page needs.

### Tailwind table markup idiom
`app/expenses/page.tsx:31-58` (structure):
```
<div className="overflow-x-auto">
  <table className="w-full text-sm [&_a]:underline [&_td:nth-child(5)]:text-right [&_td:nth-child(5)]:tabular-nums [&_td]:py-1 [&_td]:pr-3 [&_th]:py-1 [&_th]:pr-3 [&_tr]:border-b">
    <thead>
      <tr className="text-left text-slate-700">
        <th>Date</th><th>Type</th><th>Description</th><th>Check #</th><th className="text-right">Amount</th><th>Cleared</th>
      </tr>
    </thead>
    <tbody>
      {rows.map((r) => (
        <tr key={r.expid}>
          <td><a href={`/expenses/${r.expid}`}>{r.expdate}</a></td>
          ...
        </tr>
      ))}
    </tbody>
    <tfoot>
      <tr className="font-semibold">
        <td colSpan={4}>Total (...)</td>
        <td className="text-right tabular-nums" data-testid="expense-total">{total}</td>
        <td />
      </tr>
    </tfoot>
  </table>
</div>
```

### data-testid usage
- `app/expenses/page.tsx:54`: `data-testid="expense-total"`
- `app/expenses/case-panel.tsx`: `data-testid="expenses-panel"`, `data-testid="case-expense"`, `data-testid="expenses-total"`
- `app/cases/results-table.tsx`: `data-testid="case-results"`
- `app/layout.tsx`: `data-testid="session-email"`, `data-testid="session-role"`
- Convention: kebab-case, component/section-scoped names (`<section>-<role>`), not generic IDs.
- Journey 06 requires `data-testid="report-results"` on `/reports` — follow this exact naming convention.

### Error surfacing via query params
- `app/expenses/new/page.tsx:23`: `const error = first(searchParams.error);`
- `app/expenses/expense-form.tsx:34`: `{error && !fieldErr && <p role="alert" className="text-sm text-red-700 sm:col-span-2">{expenseErrorMessage(error)}</p>}`
- Pattern: error code read from `?error=` query param, mapped through a page/form-local `*ErrorMessage()` function, rendered with `role="alert"`.

### lib/auth/sections.ts — full registry (verbatim, lines 1-16)
```typescript
export const SECTIONS = [
  { href: "/cases", label: "Cases" },
  { href: "/inquiries", label: "Inquiries" },
  { href: "/firms", label: "Firms" },
  { href: "/attorneys", label: "Attorneys" },
  { href: "/clients", label: "Clients" },
  { href: "/time", label: "Time" },
  { href: "/bills", label: "Bills" },
  { href: "/expenses", label: "Expenses" },
  { href: "/funds", label: "Funds" },
  { href: "/bank-review", label: "Bank review" },
  { href: "/documents", label: "Documents" },
  { href: "/reports", label: "Reports" },
  { href: "/dashboard", label: "Dashboard" },
] as const;
```
`/documents` (line 13), `/reports` (line 14), `/dashboard` (line 15) are **already declared** — this lane wires up pages for routes the nav already expects, it does not need to add nav entries.

### Patterns to Follow
- New `/reports` and `/dashboard` pages: import `createServerClient` from `@/lib/db/client`, cast to `Db` at call sites exactly like `app/expenses/page.tsx`.
- Use `data-testid="report-results"` on whatever element holds report output (mandated by journey 06, see next area).
- Match the existing Tailwind table classes verbatim for any tabular report output rather than inventing new table styling.
- Nav entries for `/reports` and `/dashboard` already exist in `lib/auth/sections.ts` — no change needed there.

### Risks
- None found specific to this area beyond the two `Db`-type-source inconsistency already flagged in Area 1 (which pages paper over with `as unknown as Db` casts).

---

## Area: test-conventions-and-execution

### Relevant Files
- `package.json:12` — `test` script
- `tests/money/*.test.mjs` (27 files), `tests/billing/*.test.mjs` (20 files) — unit test shape
- `tests/money/fakedb.mjs` (55 lines) — in-memory PostgREST fake
- `playwright.config.ts`, various `tests/**/*.live.test.mjs` — BASE_URL resolution
- `tests/journeys/*.spec.ts` — Playwright journey specs

### test script (verbatim, package.json:12)
```
"test": "tsx --test --test-concurrency=1 tests/ai-optin.test.mjs tests/qa-hosted-web.test.mjs tests/rls-forbidden-read.test.mjs tests/foundation/*.test.mjs tests/migration/*.test.mjs tests/app-shell/*.test.mjs tests/cases/*.test.mjs tests/time/*.test.mjs tests/billing/*.test.mjs tests/money/*.test.mjs"
```

### CRITICAL — tests/docs-reports/** glob coverage
**NOT matched.** The globs are an explicit enumerated list of directories (`tests/foundation/*.test.mjs`, `tests/migration/*.test.mjs`, `tests/app-shell/*.test.mjs`, `tests/cases/*.test.mjs`, `tests/time/*.test.mjs`, `tests/billing/*.test.mjs`, `tests/money/*.test.mjs`) plus 3 named root files. `tests/docs-reports/` is not among them, and `pnpm test` will not run any new `tests/docs-reports/*.test.mjs` file until `package.json:12` is edited to add `tests/docs-reports/*.test.mjs` to that list.
Exact command to run such tests directly in the interim:
```
tsx --test --test-concurrency=1 tests/docs-reports/*.test.mjs
```

### Unit test shape
- `tests/money/expense-types.test.mjs`: imports `node:test`, `node:assert/strict`, lib functions directly from `.ts` source via relative path; builds a `SEED` fixture object keyed by table name; uses a local `memDb(seed)` (structurally similar to but distinct from `tests/money/fakedb.mjs`) with `.eq/.neq/.order/.select/.insert/.update/.delete/.then()`; assertions via `assert.deepEqual`/`assert.ok`.
- `tests/billing/bills-list.test.mjs`: imports `node:test`, `node:assert/strict`, React + `renderToStaticMarkup`, and dynamically `await import(...)`s both the lib module and a view component (`app/bills/bills-list-view.tsx`); builds fixtures via a `world()`/`fakeDb()` + `bill()`/`cases()` factory helpers; uses a `Proxy`-based query builder; assertions via `assert.deepEqual`, `assert.match`, `assert.doesNotMatch` against rendered HTML text.

### tests/money/fakedb.mjs (55 lines)
Chainable methods defined (lines 37-50): `.select()`, `.insert()`, `.update()`, `.delete()`, `.eq()`, `.is()`, `.not()`, `.in()`, `.order()`, `.limit()`, `.range()`, `.maybeSingle()`, `.single()`, `.then()`.
- **`.order()` is a no-op stub** — line 45: `order: () => b,` — returns the builder unchanged, does not actually sort. Any test relying on `fakedb.mjs` for ordering behavior will not catch an ordering bug.
- **`.not()` only supports `op === "is"`** — line 43: `not: (c, op, v) => { if (op !== "is") throw new Error("fake: not() supports is"); st.filters.push((r) => (r[c] ?? null) !== v); return b; },` — a query using `.not(col, "in", [...])` (a "not in" filter) will throw against this fake, not silently misbehave. `.in()` itself is supported for positive membership, just not negated via `.not()`.
- Design intent (header comment, lines 1-2): filters apply to every row so an unfiltered/mutated update or delete hits every row, deliberately making mutation-testing gaps visible.

### BASE_URL resolution
- `playwright.config.ts:8`: `baseURL: process.env.BASE_URL ?? 'http://localhost:3100',`
- Individual `.live.test.mjs` files each hardcode their own fallback port when `BASE_URL` isn't set, and these fallbacks are **not consistent** across files: `tests/cases/shell-wiring.test.mjs:45` → `3109`; `tests/cases/create.live.test.mjs:13` → `3106`; `tests/money/bank-confirm.live.test.mjs:14` → `3100`. Observed fallbacks in this codebase span at least 3100, 3104, 3106, 3107, 3109 depending on file.
- Implication for this lane: a new `tests/docs-reports/*.live.test.mjs` must pick its own `BASE_URL` fallback port (following the `process.env.BASE_URL ?? "http://localhost:<port>"` idiom) — do not assume 3100 is free or shared; the task's port 3102 was just freed of a stale server, suggesting some existing convention already claims it for this lane.

### Journey spec structure
`tests/journeys/01-legacy-data.spec.ts:1-17` (representative, full file):
```typescript
import { test, expect } from '@playwright/test';
import { login, CASE_ID } from './helpers';

test.describe('Legacy .bak loaded into Supabase → an existing case shows its full bill, funds, and expense history unchanged', () => {
  test('staff views a migrated case and sees its bills, funds, and expenses', async ({ page }) => {
    await login(page, 'staff');

    await page.goto(`/cases/${CASE_ID}`);
    await expect(page).toHaveURL(new RegExp(`/cases/${CASE_ID}$`));

    await expect(page.getByRole('heading', { name: new RegExp(String(CASE_ID)) })).toBeVisible();
    await expect(page.getByRole('heading', { name: /bills/i })).toBeVisible();
    await expect(page.getByRole('heading', { name: /funds received/i })).toBeVisible();
    await expect(page.getByRole('heading', { name: /expenses/i })).toBeVisible();
  });
});
```
Structure: `@playwright/test` import (`test`, `expect`), shared `./helpers` (`login(page, role)`, fixture constants); one `test.describe` wrapping one `test`; `page.goto`, `page.getByRole`/`getByText`/`getByLabel`/`getByTestId` selectors; `expect(...).toBeVisible()`/`toHaveURL()`/`not.toBeEmpty()` assertions. `tests/journeys/` directory also contains `fixtures/`, `helpers.ts`, `README.md`.
Run via `pnpm test:journeys` (`package.json`: `"test:journeys": "playwright test"`).

### Patterns to Follow
- New unit tests for this lane go under `tests/docs-reports/*.test.mjs`, following the `tests/money/`/`tests/billing/` shape (node:test + node:assert/strict + a local fake-db builder), but **`package.json`'s `test` script must be edited to add `tests/docs-reports/*.test.mjs`** or these tests never run in CI/`pnpm test`.
- Do not rely on `tests/money/fakedb.mjs`'s `.order()` to validate report sort order — it's a stub; either sort in JS before asserting, or write a local fake that actually orders (as `tests/money/expense-types.test.mjs`'s own `memDb` does with `.order()` via `localeCompare`, distinct from `fakedb.mjs`).
- Do not write a query using `.not(col, "in", [...])` against `fakedb.mjs` — it throws; use `.in()` for positive membership and invert the fixture data instead, or build a local fake like `expense-types.test.mjs` does.

### Risks
- The single biggest correctness risk for this lane's tests: silently not running. If a new `tests/docs-reports/*.test.mjs` is added but the `test` script glob isn't updated, `pnpm test` (771 pass / 0 fail / 215 skip baseline) will keep passing while the new tests never execute — this must be caught by whoever edits `package.json` for this lane.
- `fakedb.mjs`'s `.order()` stub means any test asserting report row order against that specific fake gives a false pass even if real ordering is broken.

---

## Area: journey-06-acceptance

### Relevant Files
- `tests/journeys/06-dashboard-reports.spec.ts` — acceptance target for `/dashboard` and `/reports`

### Full file (verbatim)
```typescript
import { test, expect } from '@playwright/test';
import { login } from './helpers';

test.describe('Partner opens dashboard → sees due/overdue/waiting/unpaid by priority → runs P&L, YearlyExpense, and accountant export for a date range', () => {
  test('dashboard shows priority sections and reports return non-empty results', async ({ page }) => {
    await login(page, 'admin');

    await page.goto('/dashboard');
    await expect(page.getByText(/due/i)).toBeVisible();
    await expect(page.getByText(/overdue/i)).toBeVisible();
    await expect(page.getByText(/waiting/i)).toBeVisible();
    await expect(page.getByText(/unpaid/i)).toBeVisible();

    await page.goto('/reports');
    await page.getByLabel(/start date/i).fill('2026-01-01');
    await page.getByLabel(/end date/i).fill('2026-06-30');

    await page.getByRole('button', { name: /p&l|profit/i }).click();
    await expect(page.getByTestId('report-results')).not.toBeEmpty();

    await page.getByRole('button', { name: /yearly ?expense/i }).click();
    await expect(page.getByTestId('report-results')).not.toBeEmpty();

    await page.getByRole('button', { name: /accountant export/i }).click();
    await expect(page.getByTestId('report-results')).not.toBeEmpty();
  });
});
```

### Selectors and assertions, in order (all against /dashboard and /reports only — no other routes touched)
1. `page.goto('/dashboard')` — line 8
2. `expect(page.getByText(/due/i)).toBeVisible()` — line 9
3. `expect(page.getByText(/overdue/i)).toBeVisible()` — line 10
4. `expect(page.getByText(/waiting/i)).toBeVisible()` — line 11
5. `expect(page.getByText(/unpaid/i)).toBeVisible()` — line 12
6. `page.goto('/reports')` — line 14
7. `page.getByLabel(/start date/i).fill('2026-01-01')` — line 15
8. `page.getByLabel(/end date/i).fill('2026-06-30')` — line 16
9. `page.getByRole('button', { name: /p&l|profit/i }).click()` — line 18
10. `expect(page.getByTestId('report-results')).not.toBeEmpty()` — line 19
11. `page.getByRole('button', { name: /yearly ?expense/i }).click()` — line 21
12. `expect(page.getByTestId('report-results')).not.toBeEmpty()` — line 22
13. `page.getByRole('button', { name: /accountant export/i }).click()` — line 24
14. `expect(page.getByTestId('report-results')).not.toBeEmpty()` — line 25

### Patterns to Follow
- `/dashboard` must render plain visible text matching each of `/due/i`, `/overdue/i`, `/waiting/i`, `/unpaid/i` (case-insensitive substring, `getByText` — not `data-testid`-gated).
- `/reports` must expose form controls reachable via `getByLabel(/start date/i)` and `getByLabel(/end date/i)` (actual `<label>` association required, not just placeholder text).
- `/reports` must expose three distinct buttons matched by `getByRole('button', { name: ... })` with accessible names matching `/p&l|profit/i`, `/yearly ?expense/i`, `/accountant export/i` respectively.
- Every report run (regardless of which of the 3 buttons) must populate the **same** `data-testid="report-results"` element with non-empty content — a single shared results container, not one per report type.
- Test logs in as `'admin'` via `login(page, 'admin')` from `./helpers` — confirm admin role has access to both routes.

### Risks
- The regexes are loose (`/p&l|profit/i`, `/yearly ?expense/i` matches "Yearly Expense" or "YearlyExpense") — button copy has flexibility but must contain one of these token patterns.
- `not.toBeEmpty()` only checks the results container has *some* content after each click — it does not assert on actual report values, so this journey is a wiring/rendering check, not a correctness check of report numbers.
