---
"react-doctor": patch
---

Fix `--staged` refusing to scan in linked git worktrees when `GIT_DIR` is set. Clear the inherited `GIT_DIR` environment variable in the staged divergence check so git status resolves paths correctly, matching the fix for scoped scans in #1516.
