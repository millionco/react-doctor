---
"oxlint-plugin-react-doctor": patch
---

perf: memoize `closureCaptures` per (ScopeAnalysis, function node) so nested callbacks compute once and every calling rule reuses the result, and drop the redundant per-reference containment re-filter
