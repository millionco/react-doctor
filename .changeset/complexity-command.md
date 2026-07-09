---
"react-doctor": patch
"oxlint-plugin-react-doctor": patch
---

Add a standalone `react-doctor complexity` command that ranks function complexity, supports JSON and base-ref diff output, and reuses the oxlint plugin's complexity analyzer.

Relative diff refs like `HEAD~1` and `HEAD^` are now resolved before baseline materialization, so they work the same as full SHAs and branch names.
