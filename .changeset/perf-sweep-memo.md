---
"oxlint-plugin-react-doctor": patch
---

perf: memoization sweep — per-file/per-Program analyses stop recomputing per node and per rule (security-scan path classification cached per pattern+path, layout export scans cached per file with mtime invalidation, effect scope/reference/upstream-ref lookups memoized per analysis, the duplicated outer-scope scan converged onto getScopeForNode, zod import classification memoized per identifier, and normalizeFilename skips the no-op allocation)
