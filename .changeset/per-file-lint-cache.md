---
"oxlint-plugin-react-doctor": patch
"@react-doctor/core": patch
"react-doctor": patch
---

Add a per-file content-addressed lint cache so repeat scans re-lint only the files whose content changed. On a warm scan the oxlint pass partitions the file list by content hash: unchanged files replay their cached raw diagnostics, and only changed files are re-linted. The five cross-file rules (`no-barrel-import`, `nextjs-missing-metadata`, `nextjs-no-use-search-params-without-suspense`, `no-mutating-reducer-state`, `rn-prefer-expo-image`) — whose verdict for a file can depend on _other_ files — always run fresh in a never-cached sidecar pass, so a dependency change can never serve a stale verdict. Output is byte-identical with the cache on or off (the design invariant), so the score, JSON report, and `inspect()`/`diagnose()` return values are unchanged.

The cache is on by default and content-hashed (so it survives CI re-clones), and is automatically bypassed in audit mode, when an `extends` lint config is adopted, or when user plugins are configured. Disable it with `REACT_DOCTOR_NO_FILE_CACHE=1`; the existing `REACT_DOCTOR_NO_CACHE=1` now disables both the whole-repo scan cache and this per-file cache. A `cross-file-rules` guard test fails if a future rule starts reading other files without being carved into the always-fresh sidecar. The CLI reports cache effectiveness on its Sentry run event as `lintCacheHitRatio`.

`oxlint-plugin-react-doctor` now exports `CROSS_FILE_RULE_IDS`, the canonical set of rules whose verdict can depend on other files.
