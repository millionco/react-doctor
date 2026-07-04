---
"@react-doctor/core": patch
---

Fix `--staged` silently scanning nothing when the project is a subdirectory of the git repo (the standard monorepo layout, e.g. `apps/webui`). Staged paths are collected project-relative (`git diff --cached --relative`), but the staged-content read used a bare `git show :<path>` index pathspec, which git resolves against the repo root — so in a subproject every read missed, the file was silently skipped, and the scan "passed" with `scannedFileCount: 0` (particularly dangerous in a pre-commit hook). The index read now uses the cwd-relative `git show :./<path>` form, matching how baseline `<ref>:<path>` reads were already resolved.
