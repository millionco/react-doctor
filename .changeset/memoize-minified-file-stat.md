---
"react-doctor": patch
---

Memoize the large-minified-file stat/sniff so each source path is statted and content-sniffed at most once per process. A full scan enumerates the source tree more than once — `countSourceFiles` during discovery, `listSourceFiles` during the lint pass, and `collectSecurityScanFiles` during the env-check phase — and every `≥20KB` candidate was `statSync`'d (plus a 64KB content read) on each walk. A module-scope path-keyed cache collapses that to a single stat/sniff per file, wired into the existing `clearCaches()` invalidation contract so long-running `diagnose()` consumers still re-read files that change between calls. Behavior is unchanged (identical diagnostics and `sourceFileCount`); this only removes redundant pre-lint syscalls on full scans.
