---
"react-doctor": patch
"oxlint-plugin-react-doctor": patch
---

Add a standalone `react-doctor complexity` command that ranks function complexity, supports JSON and base-ref diff output, and reuses the oxlint plugin's complexity analyzer.

The command now keeps its own `--help` / `-h` flags, ranks diff rows by the selected sort metric, counts cognitive-only changes in the diff summary, applies `--min` consistently to JSON and terminal output, and reports removed-file paths using the scanned project directory.

Relative diff refs like `HEAD~1` and `HEAD^` are now resolved before baseline materialization, so they work the same as full SHAs and branch names.

Diff mode now also reports change-complexity decomposition: essential change, raw line churn, bloat ratio, nesting delta, entropy, and an overall change-complexity score.

The terminal output now starts with a headline 0–1 complexity score and a compact table so the command is readable at a glance.
