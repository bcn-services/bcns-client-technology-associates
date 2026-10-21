# STANDARDS.md

## Request path
- **Best-effort notifications**: `notifyBestEffort` (lib/tickets.ts) never rejects and logs `<action> notify ticket <id>:`. Add awaits it (the new id is returned); Close/Reopen fire it with `void` after the write (long-lived `next start` process, 5s fetch timeout bounds the dangling promise). Any new unawaited send must go through a never-rejecting wrapper like this one.

## UI
- **Re-keyed forms**: server-rendered forms that redirect to their own URL are keyed with a per-render stamp (`Date.now()`) so the redirect remounts them and clears inputs and any client state (e.g. SubmitButton `clicked`).
- **Submit buttons**: ticket forms use `app/tickets/submit-button.tsx` (`useFormStatus`, disabled while pending, "Saving…" on the clicked button only).

## Tests
- **useFormStatus shim**: react-dom 18.3 has no `useFormStatus` under plain node; render tests assign `createRequire(import.meta.url)("react-dom").useFormStatus` (see tests/tickets/page.test.mjs, tests/cases/convert.test.mjs).
