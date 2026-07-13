---
"react-doctor": patch
---

Exit nonzero when the lint pass hard-fails (a configured plugin or engine failure) instead of silently reporting a clean scan. Routine code-less diagnostics (unparseable files, unused-directive warnings) no longer reject the whole lint pass, fail-open degradations (`--no-lint`, `--max-duration` truncation, supply-chain/security skips) stay advisory, and `--blocking none` keeps the scan advisory.
