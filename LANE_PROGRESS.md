# Technology Associates — case-docs lane progress

LANE.md is the contract; this tracks where we are in it — if they disagree, LANE.md wins for scope.

## Current position

- **Status:** round 1 (autonomous run) in progress — items 1–3 done; one follow-up fix (report year) in progress.
- **Next:** fix the CTA Report year, then the lane acceptance check and merge.
- **Blockers:** none.
- **Last updated:** 2026-09-30

## Round 1 — case documents

| Item | Status |
|------|--------|
| Fill engine | done — The app can now take any of the four Word templates, put text into its named blanks (escaping symbols, keeping the template's fonts, turning line breaks into new lines), and hand back a normal Word document with everything else in the file unchanged. |
| Case values per document | done — For any case the app now works out what goes in each document's blanks the way Access did: the attorney's name with Esq., the firm and its address, the case caption and title, the case number, and today's date in New York time; a case with no attorney still works with those blanks left empty. |
| Download links on the case page | done — Each case page now has Memo, CTA Report, File Review Summary and Inspection Plan links beside Mailing label; clicking one downloads that case's filled Word file, signed-out visitors are sent to the login page, and a bad link shows a plain "not found". |
