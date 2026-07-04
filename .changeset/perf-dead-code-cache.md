---
"react-doctor": patch
---

Rescans now skip the dead-code analysis entirely when nothing it reads has changed. The pass persists its diagnostics keyed by a fingerprint over the analyzed source tree (stat-based, so additions, deletions, and edits all invalidate), the project's manifests, tsconfigs, lockfiles, knip/entry/ignore configuration, and the analyzer version — on an unchanged-input rerun the stored result replays instead of re-walking the whole import graph, cutting several seconds off warm rescans of large repos. Only complete, successful passes are stored; `REACT_DOCTOR_NO_CACHE` (or the granular `REACT_DOCTOR_NO_DEAD_CODE_CACHE`) disables it.
