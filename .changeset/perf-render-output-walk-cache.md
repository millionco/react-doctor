---
"oxlint-plugin-react-doctor": patch
---

perf: memoize `functionContainsReactRenderOutput` per function node so the ~5 rules sharing it walk each function subtree once per file instead of once per query
