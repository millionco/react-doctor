---
"oxlint-plugin-react-doctor": patch
---

Fix a false positive in `no-loading-flag-reset-outside-finally` when a catch handler formats fallback state with `String()`, `Math.round()`, and `performance.now()`.
