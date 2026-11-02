---
"react-doctor": patch
---

`--scope changed --include-untracked` now treats a tracked file that was deleted and recreated at an untracked path as a rename, so its existing findings match the base instead of being reported as new and fixed.
