---
"oxlint-plugin-react-doctor": patch
---

fix: respect "use no memo" directive in react-compiler-no-manual-memoization rule

When a function or module has a React Compiler opt-out directive, the compiler skips optimization, so manual memoization can still be necessary. The rule now respects `"use no memo"`, its `"use no forget"` alias, and local components passed to `memo`.

Fixes #1749
