---
"@react-doctor/core": patch
---

fix(git): prefer remote tracking branch for --scope changed auto-detection

When running `--scope changed` without an explicit `--base` flag, React Doctor now auto-detects `origin/<branch>` instead of just `<branch>` when the remote tracking branch exists. This fixes the issue where committed changes on a feature branch (or on main ahead of origin/main) were not detected unless `--base origin/main` was explicitly specified.

Fixes #1674
