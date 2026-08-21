---
"@react-doctor/core": patch
---

Fix false positives in unused-file detection for implicit sub-projects outside workspace patterns. When a root package.json declares workspaces, sub-projects outside the declared workspace globs were discovered but their entry points (main, bin, exports) were skipped, causing legitimate files to be incorrectly reported as unused.
