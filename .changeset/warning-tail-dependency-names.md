---
"react-doctor": patch
---

Name every unused dependency in the verbose warning tail.

Unused-dependency warnings all report at the same line-less location (`package.json:0`), so the dim location header collapsed every finding into one line and dropped the package names — leaving only a generic `deslop/unused-dependency ×N` line (#690). `react-doctor --verbose` now lists each `deslop/unused-dependency` and `deslop/unused-dev-dependency` by name, with the shared "why" explanation shown once instead of repeated per package. Errors and code-frame rendering are unchanged.
