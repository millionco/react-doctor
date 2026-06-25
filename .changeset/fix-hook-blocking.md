---
"react-doctor": patch
---

Fix pre-commit hook to actually block commits when diagnostics are found. The hook previously captured output but never exited with non-zero status, allowing commits to proceed despite blocking diagnostics. The hook now displays react-doctor output and exits with status 1 to properly block commits.
