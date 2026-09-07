---
"react-doctor": patch
"@react-doctor/core": patch
---

Add diagnostic logging for baseline degradation causes. When `--scope changed` degrades to plain diff mode, `--verbose` now prints which check failed (deadline exhausted, snapshot incomplete, expected files missing, base lint failed, etc.) instead of silently returning null. The JSON report also includes `baselineDegradationReason` with a machine-readable code so the GitHub Action comment can provide accurate guidance instead of always suggesting `fetch-depth: 0` when the real cause is different.

Fixes #1768
