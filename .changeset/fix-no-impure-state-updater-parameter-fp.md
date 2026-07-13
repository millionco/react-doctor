---
"oxlint-plugin-react-doctor": patch
---

fix(no-impure-state-updater): skip function parameters passed as data to setters

Function parameters passed to state setters (e.g., `setA(row)` where `row` is a parameter) were incorrectly treated as updater functions, causing false positives when the enclosing function also performed other operations like calling another setter.

The fix ensures `resolveToFunction` skips parameter definitions, matching the behavior of the `ascend` helper that already filters them out.
