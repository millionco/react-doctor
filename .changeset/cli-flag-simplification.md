---
"react-doctor": minor
---

Simplify the CLI flag surface (fewer flags, fewer footguns):

- **`--explain` / `--why` → `react-doctor why <file:line>`.** The "why did a rule fire here / why didn't my suppression apply" diagnostic is now a subcommand. This also removes its mutual-exclusion errors with `--json` / `--score` / `--staged`. (`rules explain <rule>` still explains what a rule means.)
- **Removed `--pr-comment`.** It's unused — the GitHub Action renders its comment from `--json`. Use the `surfaces` config to scope which diagnostics reach PR comments / the score / the CI gate.
- **Removed the positive `--respect-inline-disables`** (it was already the default). Inline suppressions are respected by default; pass `--no-respect-inline-disables` (or set `respectInlineDisables: false` in config) for audit mode.
- **Hid the internal `--changed-files-from`** from `--help` (it's plumbing used by the GitHub Action, not user surface; still works).
