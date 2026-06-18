---
"react-doctor": patch
---

Add a per-project `scannedFileCount` to the JSON report's `projects[]` entries —
the number of source files the scan's linter examined (the changed React-eligible
files in diff mode, the whole source tree in a full scan). It's additive and
optional, so the `schemaVersion` is unchanged and existing consumers are unaffected.

This lets the GitHub Action tell "a PR that changed no React-eligible files" (the
linter examined nothing — `scannedFileCount: 0` for every project) apart from "a
clean scan of real React changes" (`scannedFileCount >= 1`), which previously
produced identical reports. The Action now treats the former as a no-op: it skips
the sticky PR comment entirely and the commit status reads "Skipped — no React
files changed" instead of a zero-filled score line. A clean scan of real React
changes still posts its "no issues 🎉" comment.
