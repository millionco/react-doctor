---
"oxlint-plugin-react-doctor": minor
"@react-doctor/core": minor
"react-doctor": minor
---

Classify every rule on three axes and carry them per-finding. Each rule now declares required `impact` (`behavior` | `style` | `perf` | `a11y` | `security`), `confidence` (`high` | `heuristic`), and `fix` (`mechanical` | `local` | `structural`) metadata, projected into its `tags` as `impact:*` / `confidence:*` / `fix:*`. Diagnostics in the JSON report now carry a `tags` array (next to `category`), so a consumer can classify a finding with `diagnostic.tags.includes("impact:behavior")` instead of a rule-name regex — stable across releases. New repeatable `--ignore-tag <tag>` scan flag disables rules carrying a tag (e.g. `--ignore-tag impact:style`), unioned with config `ignore.tags`.
