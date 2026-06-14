---
"@react-doctor/core": patch
"react-doctor": patch
---

Fix a supply-chain scan crash on npm dist-tags and wildcards (#807).

`resolveConcreteVersion` called `semver.minVersion(spec)` directly, but `semver` **throws** (`TypeError: Invalid comparator: latest`) on a non-range spec instead of returning `null`. Any full scan — or PR scan touching `package.json` — containing a dist-tag like `"trigger.dev": "latest"` (or `"next"`) crashed before the Socket fail-open path could run (regression from #804, affecting 0.5.3–0.5.5).

The spec is now validated with `semver.validRange` before resolving its floor: dist-tags and other non-ranges are skipped (nothing to score), as is a wildcard-only range (`*`/`x`/`X`), which previously resolved to a synthetic `0.0.0` and scored a version nobody pinned. Real ranges (`^1.2.3`, `1.x`, `>=2 <3`) and protocol/URL specs (`workspace:`, `file:`, `npm:`, `git+…`) are unchanged.
