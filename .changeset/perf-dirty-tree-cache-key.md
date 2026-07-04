---
"react-doctor": patch
---

Instant reruns now also work with uncommitted changes: the whole-repo scan-result cache no longer requires a clean worktree — it keys on the exact dirty state (every modified, staged, renamed, deleted, and untracked path plus a hash of its content), so rescanning the same work-in-progress tree hits the cache while any edit still invalidates it.
