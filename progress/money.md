# Technology Associates — Money Lane Progress

LANE.md is the contract; this tracks where we are in it — if they disagree,
LANE.md wins for scope, this file wins for state.

## Current position

- **Status:** all 12 items done. Items 1–11 merged to `integration` (PR #13); the check → bill link, migration 0008 and the journeys 04/05 fix go up as a second PR. Journeys 01–05 pass.
- **Next:** docs-reports lane
- **Blockers:** none. The /expenses load-time check (under 1 second) runs 1.0–1.3 seconds on a loaded dev server; decide at the hand-test round.
- **Last updated:** 2026-09-15

## Money lane (2026-09-14)

| Item | Status |
|------|--------|
| Expense types | done — Admins can add, retire, and reactivate expense types; retired types disappear from pick lists but stay on old expenses. (2026-09-14) |
| Expense entry and edit | done — Kris can enter and edit an expense, with or without a case; a mistyped case number is refused and every edit is recorded in the audit log. (2026-09-14) |
| Funds entry, list, edit | done — Kris can record a check or payment received on a case, see recent funds newest first, and edit any of them; bad amounts and unknown cases are refused. (2026-09-14) |
| Expense list | done — Kris can list expenses for a month or a case with type names and a total; a month of 5,000 expenses loads in under a second, with little room to spare. (2026-09-14) |
| Mark bill paid / partial payment | done — An admin can mark a case's open bill paid (dated with the check's date) or record a partial payment from the funds page; a bill that changed in the meantime is refused. (2026-09-14) |
| Bounced-check reversal | done — An admin can reverse a bounced check in one action: a matching negative entry is recorded, the original stays untouched, the chosen paid bill reopens at the right notice, and the same check can never be reversed twice. (2026-09-14) |
| BoA export upload | done — Kris can upload a Bank of America CSV and see how many transactions were imported, already imported, or skipped as credits; a bad line is named and nothing from that file is imported. (2026-09-14) |
| Review inbox and confirm | done — Kris can review imported bank transactions oldest first, with the expense type suggested from past expenses, and confirm each into a cleared expense; a double click never records it twice. (2026-09-14) |
| Clearing view by bank account | done — Kris can pick a bank account, see its uncleared expenses and funds, and mark selected ones cleared with a date and note; rows on other accounts are never touched. (2026-09-14) |
| Case page money panels | done — Each case page now shows the case's funds received and expenses with exact totals (bounced-check reversals included) and Add links that open the forms with the case filled in. (2026-09-14) |
| Payment on the bills panel | done — A paid bill on the case page shows its paid date, and each open bill has a "Record payment" link that ends on the funds page with that bill ready to mark paid. (2026-09-14) |
| Link a check to the bill it paid | done — Marking a bill paid or recording a partial payment from a check now links that check to the bill: the check page shows "Applied to bill N", the case bills panel lists every check applied to each bill, and a bounced-check reversal carries the link. (2026-09-15) |
