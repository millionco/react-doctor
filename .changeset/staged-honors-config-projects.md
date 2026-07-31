---
"@react-doctor/core": patch
"react-doctor": patch
---

`--staged` now honors `--project` and the config's `projects` field, so a monorepo pre-commit scan stops reporting clean with every React rule gated off. Each selected package brings its own `package.json` / `tsconfig` / config into the staged snapshot, and every staged path belongs to exactly one package. Selecting a package also makes the `--json` report package-scoped, so `packageRoot` is no longer always the report's `directory`; diagnostic ids are unchanged, so baselines still match.

Selecting several packages prints the aggregate project summary rather than a single-scan report, notes how many staged files fell outside the selected projects, and writes `--output-dir` on a quiet (`--json` / `--score`) run where it previously wrote nothing.

Failures stay out of the committer's way. A `projects` entry that no longer resolves, or that points outside the scanned tree, warns and falls back to a root scan rather than blocking every commit; an explicit `--project` still fails, since it was typed this run. A staged run whose git index cannot be read fails rather than treating it as empty, but individual paths that cannot be snapshotted are reported and skipped, and when nothing is left to scan the run warns and exits 0 — nobody can act on an oversized blob mid-commit, and failing would only send them to `--no-verify`.
