---
"react-doctor": patch
"deslop-js": patch
---

Hardened the dead-code result cache key against two silent-staleness classes. The fingerprinted extension and manifest name lists are now imported from `deslop-js/analyzed-inputs` — a new dependency-free subpath export assembled from the same constants deslop's own readers consume — so a deslop upgrade that widens its walk can never under-invalidate the cache. And the key now includes `@react-doctor/core`'s own version, so upgrading react-doctor re-analyzes instead of replaying cached diagnostics shaped by an older core's post-processing. The cache schema-version constant remains for cache-format changes only.
