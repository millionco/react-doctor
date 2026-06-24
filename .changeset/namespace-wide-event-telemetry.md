---
"react-doctor": patch
---

Organize the per-scan Sentry "wide event" under dotted namespaces. The root-span attributes had accreted into a flat, half-namespaced set (~50 keys, most bare); each now carries a namespace matching its concept — `scan.*` (config + `scan.fileCount`), `action.*` (CI/action knobs), `outcome.*` (verdict), `diag.*` (findings), `score.*`, `lint.*`, `deadCode.*`, `supplyChain.*`, `timing.*` — alongside the already-namespaced `migration.*`/`baseline.*`. Applied via a single `withNamespace` helper so the prefix lives in one place instead of being hand-spelled per key. Pure rename: value types are preserved (numbers stay numeric so `p75`/`avg` keep working) and the keys stay filter-/group-/aggregate-able in Sentry's Spans dataset. Run/project base tags and all metrics are unchanged.
