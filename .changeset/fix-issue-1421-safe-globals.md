---
"oxlint-plugin-react-doctor": patch
---

Fix false positive in `no-loading-flag-reset-outside-finally` when catch handler uses safe global functions like `performance.now()`, `Math.round()`, `String()`, etc. The rule now recognizes these standard library functions as non-throwing.
