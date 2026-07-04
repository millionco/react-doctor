---
"react-doctor": patch
---

Fix whole-repo scan cache replaying another project's diagnostics when a .git-less checkout sits inside an unrelated repository (e.g. a gitignored benchmark/mining clone directory reused across projects). The cache key's git identity (HEAD sha, worktree fingerprint) resolved from the enclosing repository, which cannot see the checkout's files, so two different projects materialized at the same path keyed identically. The key now requires the fingerprinted repository to actually track files under the project directory (cache off otherwise), and every cache hit re-verifies the stored payload's directory and `package.json` content hash so any future keying bug of this class degrades to a miss instead of a cross-project replay.
