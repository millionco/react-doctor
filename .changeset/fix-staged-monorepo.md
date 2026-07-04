---
"react-doctor": patch
"@react-doctor/core": patch
---

fix: --staged now works in monorepo subdirectories

Fixed a bug where `--staged` silently scanned nothing when the project is in a subdirectory of the git repo (standard monorepo layout). The CLI would report "No issues found!" with `scannedFileCount: 0` because staged file paths were resolved incorrectly.

The fix changes `git show :<path>` to `git show :./<path>` to use cwd-relative pathspecs, matching how baseline reads already work.
