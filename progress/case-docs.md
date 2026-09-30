# Technology Associates — case-docs lane progress

LANE.md is the contract; this tracks where we are in it — if they disagree, LANE.md wins for scope.

## Current position

- **Status:** round 1 complete — items 1–3 done, plus two fixes from QA and the acceptance review (the CTA Report's year, the Inspection Plan's page header); lane acceptance review 2/3, its one gap (the Inspection Plan header) fixed and tested afterwards, not re-reviewed.
- **Next:** /merge-lane — merge the case-docs PR into integration; Nate opens the four sample files in Word.
- **Blockers:** none.
- **Last updated:** 2026-09-30

## Round 1 — case documents

| Item | Status |
|------|--------|
| Fill engine | done — The app can now take any of the four Word templates, put text into its named blanks (escaping symbols, keeping the template's fonts, turning line breaks into new lines), and hand back a normal Word document with everything else in the file unchanged. |
| Case values per document | done — For any case the app now works out what goes in each document's blanks the way Access did: the attorney's name with Esq., the firm and its address, the case caption and title, the case number, and today's date in New York time; a case with no attorney still works with those blanks left empty. |
| Download links on the case page | done — Each case page now has Memo, CTA Report, File Review Summary and Inspection Plan links beside Mailing label; clicking one downloads that case's filled Word file, signed-out visitors are sent to the login page, and a bad link shows a plain "not found". |
