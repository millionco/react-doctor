---
"react-doctor": patch
---

Fix GitHub Action shallow conversion regression that broke baseline mode with `fetch-depth: 0`. The action's best-effort base commit fetch now checks if the commit is already present before running `git fetch --depth=1`, preventing full clones from being converted to shallow repositories and losing merge-base reachability for PRs whose branch point predates the current base.
