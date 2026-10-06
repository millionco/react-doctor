---
"oxlint-plugin-react-doctor": patch
---

fix(async-defer-await): recognize parameter-based compound freshness guards

Fixes #1895. The rule now correctly identifies function parameters as immutable snapshots in compound post-await freshness guards. Previously, guards like `if (id !== requestId.current || latest.current.query !== query) return` would incorrectly warn when comparing parameters to mutable state, even though parameters are captured at call time and can safely detect stale responses.
