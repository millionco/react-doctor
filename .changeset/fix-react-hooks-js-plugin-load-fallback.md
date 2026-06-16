---
"@react-doctor/core": patch
"react-doctor": patch
---

Stop a broken `eslint-plugin-react-hooks` install from sinking the whole lint pass, and fix the misleading error it produced (issue #833).

When the optional `react-hooks-js` (React Compiler) plugin can't be imported in the user's environment, oxlint fails the entire config load — which previously dropped every curated react-doctor diagnostic too and left the scan with `skippedChecks: ["lint"]` and zero results. The oxlint error is also multi-line, and the 200-char error preview truncated its plugin path mid-string (often right at `…/node_modules/`), so it read as react-doctor passing an invalid directory rather than a plugin that failed to load.

- **Graceful degradation:** the oxlint runner now detects a `react-hooks-js` plugin-load failure and retries once with that plugin (and its compiler rules) dropped — mirroring the existing adopted-`extends` fallback. The curated react-doctor rules, dead-code, and environment checks all still run; only the React Compiler rules are skipped, surfaced as a clear `lint:partial` note that includes oxlint's real underlying reason.
- **Readable error:** the unparseable-output preview grew from 200 to 600 chars so the full plugin path and the underlying `Error:` line survive instead of being cut at `…/node_modules/`.
