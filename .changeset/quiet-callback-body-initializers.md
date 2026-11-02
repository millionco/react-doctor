---
"oxlint-plugin-react-doctor": patch
---

Avoid context value warnings when a helper replaces its incoming callback with a function that only returns a literal, then returns the replacement's result. Recognize declaration-only helpers with bare var redeclarations, unconditional var blocks, unused callback aliases or restoration functions, and a local holding the replacement's result.
