---
"oxlint-plugin-react-doctor": patch
---

Avoid sequential-await warnings when local helpers read the same cache entry or delegate to the same imported operation with matching stable arguments. Preserve warnings for distinct imported operations sharing an input, and bound the diagnostic's parallelization advice.
