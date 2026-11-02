---
"oxlint-plugin-react-doctor": patch
---

Avoid context value warnings when a two-statement helper replaces its incoming callback with a function that only returns a literal, then returns the replacement's result.
