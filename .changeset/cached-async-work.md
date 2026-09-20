---
"oxlint-plugin-react-doctor": patch
---

Avoid sequential-await warnings when local helpers read the same cache entry or delegate to the same imported operation with matching stable arguments. Follow bounded imported helpers to guarded, module-owned Map/WeakMap caches, with dependency fingerprints for cache invalidation. Preserve warnings for distinct imported operations sharing an input, and bound the diagnostic's parallelization advice.
