---
"react-doctor": minor
---

Show `"warning"`-severity diagnostics by default again. A scan that reports only errors is too generous a bar for a health check, so warnings surface on every surface (CLI, PR comment, score, `--fail-on`) out of the box. Opt out with `--no-warnings` or `"warnings": false`; per-rule / per-category severity overrides still win as before.
