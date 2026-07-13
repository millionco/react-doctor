---
"react-doctor": patch
---

Report one actionable conditional Hook violation when React Doctor and React Compiler flag the same source location, while preserving either finding when the other is suppressed. Overlapping derived-state findings now collapse to the most specific rule even when a severity override makes their severities differ, and the surviving diagnostic carries the highest severity of the collapsed pair. The sidecar lint cache schema version is bumped so previously cached winner-only diagnostic sets are re-linted instead of replayed.
