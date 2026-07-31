---
"@react-doctor/core": patch
---

Clear inherited `GIT_DIR` from nested Git commands so scoped scans launched by Git hooks respect their working directory, while preserving `GIT_INDEX_FILE` and the rest of the environment.
