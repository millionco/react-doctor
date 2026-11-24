---
"@react-doctor/core": patch
---

Make cache partition portable via git-relative paths

Cache partition keys are now derived from git-relative project paths instead of absolute paths, enabling CI runners and local developer machines to share the same cache state when scanning the same logical project within a repository.

The partition key resolution order is:
1. `REACT_DOCTOR_CACHE_PARTITION` env var (explicit override)
2. Git-relative path from repository root (when in a git repo)
3. Absolute path (fallback for non-git projects)

Fixes #1799
