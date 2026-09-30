# Technology Associates — lane: case-docs

## Objective

From a case page, anyone signed in downloads the Memo, CTA Report, File Review
Summary, or Inspection Plan as a Word file already filled with that case's
details, ready to finish in Word.

Lane done when:
- Each of the four links on a case page downloads a `.docx` that Word opens without a repair prompt
- Each filled bookmark holds what `Form_frmCaseUpdate.bas` would have put there for the same case
- Everything else in each template (letterhead, images, boilerplate, the hand-typed bookmarks) comes through unchanged

**Status.** Second lane of the 2026-09-21 amendment; billing-output merged
2026-09-30. The four legacy templates are committed at
`lib/case-docs/templates/*.dotx` (03e48c4). Output is editable Word, not PDF
(Nate, 2026-09-30). Legacy reference, read only and not in git:
`~/Downloads/Projects/bcns/Technology-Associates/vba-source/Form_frmCaseUpdate.bas`
— `cmdMakeMemo_Click`, `cmdMakeReport_Click`, `cmdMakeSummary_Click`,
`cmdMakeInspectionList_Click`. Repo rules: `CLAUDE.md`.

Lane: case-docs — added 2026-09-21. The 4 prefilled case documents from frmCaseUpdate (Inspection Plan, Memo, CTA Report, File Review Summary) as downloads. Gated on Kris sending the .dotx templates; no LANE.md until then

Owned — this lane's items live inside these paths:
  lib/case-docs/**, app/cases/[id]/documents/**, tests/case-docs/**

Open — merged lanes. Wiring items may edit these; rebase onto `integration` first:
  scripts/migrate/**, tests/migration/**
  app/layout.tsx, app/page.tsx, app/globals.css, app/not-found.tsx, middleware.ts, app/(auth)/**, lib/auth/**, tests/app-shell/**
  app/cases/**, app/firms/**, app/attorneys/**, app/clients/**, app/inquiries/**, lib/cases/**, lib/contacts/**, lib/inquiries/**, tests/cases/**
  app/time/**, lib/time/**, tests/time/**
  app/bills/**, lib/bills/**, lib/bill-docs/**, tests/billing/**, tests/billing-output/**
  app/expenses/**, app/funds/**, app/bank-review/**, lib/expenses/**, lib/funds/**, lib/bank-import/**, tests/money/**
  app/documents/**, app/reports/**, app/dashboard/**, lib/documents/**, lib/reports/**, lib/storage.ts, tests/docs-reports/**

Stop and report if an item requires changing a path outside both lists:
  protected — supabase/migrations/**, lib/db/**, lib/auth/session.ts, lib/auth/client.ts, lib/env.ts, scripts/gen-db-types.mjs, tests/foundation/**, tests/journeys/**, playwright.config.ts, tsconfig.foundation.json
  an unmerged lane's — parity (scripts/parity/**, tests/parity/**)
  unowned — root config (package.json, pnpm-*.yaml, tsconfig, next/eslint config, *.md), .github/workflows, .claude/worktrees, app/api/health, lib/health.ts, lib/ai.ts, lib/webhooks.ts, tests/*.test.mjs, remote sync + backup

  AMENDMENT (2026-09-30) — unowned-path grant, item 1 only, approved by Nate:
  `package.json` gains the dependency `jszip` (the version already in
  `pnpm-lock.yaml` via exceljs) and `tests/case-docs/*.test.mjs` on the `test`
  script; `pnpm-lock.yaml` changes only as that declaration requires.

Frozen contracts — build and test against these; they will not move:
  cases — `lib/db/types.ts` rows for `tblcase`, `tblattorney`, `tblfirm`; fixtures in `tests/foundation/**`

Test against the fixture, not the producing lane. Do not wait for it to exist.

**Global rules**
- No new dependency beyond the `jszip` declaration above.
- No real client names, addresses, case titles or figures in any committed file or test; synthetic data only (`@example.test`). The four templates are the only legacy files in the repo.
- Nothing is stored and nothing is emailed: a document is built per request and returned as a download.
- No migration, no `process.env` outside `lib/env.ts`, queries live in `lib/**`.
- The template files under `lib/case-docs/templates/` are never edited.

## Not yet specified

- The Inspection Plan template Access uses today has CaseTitle and CaseID bookmarks; the committed copy has neither — revisit when Kris sends the current file (swap the file, regenerate, add two values).

## Out of scope

- Saving the generated document in the app — Access keeps nothing; staff upload the finished file through the case Documents panel.
- Emailing a document — v1 is download only.
- Memo templates for other branches — one branch only (MAP.md); every case uses `CTA_Memo`.
- Filling the CTA Report's `PutDocumentNumberHere`, `cvs`, `PutConferenceHere` — typed by hand in Access too.
- Inserting title and case number into the Inspection Plan — no bookmarks in this copy; shipped unfilled (Nate, 2026-09-30).

---

- task: Fill engine — `lib/case-docs/fill.ts` exports a pure function that takes
    a `.dotx` template's bytes and a map of bookmark name → text and returns
    `.docx` bytes, using jszip. It (1) sets the main part's content type in
    `[Content_Types].xml` from the template type to the document type, (2) for
    each named bookmark in `word/document.xml`, replaces the content between
    its `w:bookmarkStart` and matching `w:bookmarkEnd` with one run holding the
    XML-escaped text, keeping the run formatting found at the bookmark, with
    newlines as `w:br`, and keeps the bookmark markers, (3) removes the
    attached-template relationship if one exists (the legacy code sets
    `AttachedTemplate = ""`), and (4) leaves every other zip entry's bytes
    unchanged. A bookmark name not in the map is left as it is; a map name not
    in the template throws a named error. Also `lib/case-docs/templates.ts`: the
    four templates as base64, GENERATED from `lib/case-docs/templates/*.dotx`
    (the standalone build ships only traced code — same pattern as
    `lib/bill-docs/stamps.ts`), with its generator script under
    `lib/case-docs/`. Makes the `package.json` amendment.
  guardrails:
    - `fill.ts` imports no database, storage or Next code — bytes in, bytes out
    - Text is never inserted unescaped; `&`, `<`, `>` and quotes in a case title must not break the XML
    - No runtime `fs` read of a template — the base64 module is the only source at runtime
  done when:
    - For each of the 4 templates, the output unzips, `word/document.xml` parses as XML, the main content type is the document type, and every zip entry other than `[Content_Types].xml`, `word/document.xml` and the settings relationship file is byte-identical to the template's
    - Filling `CTA_Memo` with synthetic values puts each value between its bookmark's start and end markers, a two-line Address becomes two lines split by a `w:br`, and a title containing `&` and `<` extracts back as the same text
    - `textutil -convert txt` on each filled output exits 0 and its text contains every filled value and the template's boilerplate text
    - A test fails if `templates.ts` no longer matches the `.dotx` files on disk
  status: not started

- task: Case values per document — `lib/case-docs/docs.ts` exports the list of
    the four document kinds (slug, label, template, download file name) and a
    loader that, for a case id, a kind and a `now`, returns the bookmark map
    Access would produce. Memo — Atty (the legacy `FormatAttyName`: first,
    middle, last, Esq., title, suffix), Firm (`frmname`), Address (the legacy
    `FormatAddress`: address1, address2, city, state, zip), TodayDate
    ("mmmm dd, yyyy" in the firm's time zone — `firmToday` in
    `lib/cases/presets.ts`), TitleCaption (`casecaption` + ", " + `casetitle`).
    CTA Report — Atty (the `ContactInfo` address block the invoice already
    builds in `lib/bill-docs/invoice.ts`), Title, CaseID. File Review Summary —
    CaseTitle, CaseID, TodayDate. Inspection Plan — empty map. Reuse the
    existing loaders and formatters (`lib/cases/record.ts`,
    `lib/contacts/contacts.ts`, `lib/bill-docs/**`); read the two legacy
    formatting functions in the VBA source and match them. File names:
    `Memo <caseid>.docx`, `CTA Report <caseid>.docx`,
    `File Review Summary <caseid>.docx`, `Inspection Plan <caseid>.docx`.
  guardrails:
    - One place defines the four kinds; the route and the case page both read it
    - A case with no attorney or no firm still yields a map — those values are empty strings, never an error (Access errored; logged as an assumption)
    - The date comes from the passed `now` in the firm's time zone, never the server's local date
  done when:
    - For a synthetic case with attorney and firm, each kind's map has exactly the bookmark names listed above with the values built from that case's rows
    - With `now` at 03:30 UTC on the 1st of a month, TodayDate is the last day of the prior month (New York), under both `TZ=UTC` and `TZ=America/Los_Angeles`
    - A case with no attorney returns empty Atty, Firm and Address and a filled TitleCaption; an unknown case id returns null
    - Every bookmark name a kind returns exists in that kind's template
  status: not started

- task: Download links on the case page — a GET route
    `app/cases/[id]/documents/[doc]/route.ts` that runs `requireSession()`
    first, validates the case id and the kind slug, builds the map (item 2),
    fills the template (item 1) and returns the bytes as an attachment with the
    Word content type, the item-2 file name and `cache-control: private,
    no-store` — the shape of `app/cases/service-auths/pdf/[srvauthid]/route.ts`.
    In `app/cases/[id]/page.tsx`, add the four links beside "Mailing label" and
    "Rolodex card", rendered from the item-2 kind list.
  guardrails:
    - The case page change only adds the links; no existing panel, field or link moves
    - Staff and admins get the same links — no role check beyond a session
    - A failure returns plain text with a status code, never a half-written file
  done when:
    - Signed in as staff on a synthetic case, each of the four links downloads a `.docx` whose file name and filled values match that case
    - Signed out, the route redirects to login and returns no document bytes
    - An unknown kind slug, a non-numeric id and a missing case each return 404 with a plain message
    - Existing passing tests remain passing
  ui: true
  after: cases
  status: not started
