---
"@react-doctor/core": patch
"react-doctor": patch
---

Fix a supply-chain scan crash on npm dist-tag / non-range specs (#807).

`resolveConcreteVersion` called `semver.minVersion(spec)` directly, but
`semver@7` _throws_ (`TypeError: Invalid comparator: latest`) on specs with no
parseable range — a dist-tag (`"trigger.dev": "latest"`), a protocol/URL
(`workspace:`, `file:`, `npm:`, `git+…`, `https://…`), or a bare wildcard. That
synchronous throw happened before the Socket fetch's fail-open handling, so any
full scan (or a PR scan touching `package.json`) containing such a dep crashed
instead of emitting diagnostics.

It now validates with `semver.validRange` first (mirroring
`parseLowerBoundVersion`): specs with no concrete floor are skipped, including
the wildcard `*`/`x` whose synthetic `0.0.0` floor isn't a real published
version. Valid ranges are still scored at their floor.
