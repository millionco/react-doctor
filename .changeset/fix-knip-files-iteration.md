---
"react-doctor": patch
---

Fix `TypeError: issues.files is not iterable` crash during dead code detection. Knip 6.x returns `issues.files` as an `IssueRecords` object instead of a `Set<string>`. The dead code pass now handles both shapes (and arrays) defensively.
