---
"@react-doctor/core": patch
---

fix: clear GIT_DIR for nested git commands in scoped scans

Git hooks export `GIT_DIR`, which causes nested git commands to ignore the scoped `cwd` and return repository-root paths. This fix explicitly clears `GIT_DIR` when spawning git commands while preserving other environment variables like `GIT_INDEX_FILE`.
