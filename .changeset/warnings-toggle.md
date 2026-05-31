---
"react-doctor": patch
---

Hide `warning`-severity diagnostics by default — a clean scan now reports only `error`-severity findings (errors always show). Opt warnings back in with the `--warnings` flag or `"warnings": true` config option; `--no-warnings` / `"warnings": false` is the explicit default-off. The toggle is the master switch and runs after per-rule / per-category severity overrides, so a rule explicitly set to `"warn"` via `rules` / `categories` still shows even when warnings are hidden.

Because dead-code analysis only emits `warning`-severity findings, it's now skipped entirely when warnings are hidden (its results would be filtered out anyway) — avoiding an expensive analysis pass on the default path. `--warnings` / `"warnings": true` (and `--fail-on warning`) re-enable it.
