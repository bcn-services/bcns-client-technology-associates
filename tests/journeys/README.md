# Journey tests

These six specs ship RED on purpose — the screens they drive don't exist yet.
Each maps to one journey in `MAP.md`'s `journeys:` list (quoted verbatim in
its `test.describe` title). A spec going green means the lane that owns that
screen finished wiring it up; this suite is the acceptance signal, not a
regression suite.

## Run

1. `pnpm dev` in one shell (serves on `http://localhost:3100`)
2. `pnpm test:journeys` in another

`pnpm test:journeys --list` enumerates the six specs without running them.
