---
"react-doctor": patch
---

Restore instant reruns on large repos: raise `runGit`'s output cap so the whole-repo scan-result cache works past ~15k tracked files.

The cache's clean-worktree gates shell out to git through a helper that used Node's default 1 MiB `maxBuffer`. On repos with roughly 15-25k tracked files (getsentry/sentry: 20,343), `git ls-files -v` alone exceeds that, `execFileSync` throws ENOBUFS, the helper swallows it into `null`, and the gates read `null` as "hidden tracked state" — so the cache silently never stored or served a scan on exactly the repos where the instant-rerun path saves the most time. The helper now runs with an explicit 64 MiB cap, which clears monorepos with hundreds of thousands of files while still bounding a pathological child process.
