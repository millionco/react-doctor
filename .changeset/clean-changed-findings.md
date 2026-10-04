---
"react-doctor": patch
---

Fix changed-scope scans to compare findings for uncommitted changes and use flagged source spans instead of whole lines. Match duplicate findings by count and limit cross-file matches to Git renames.

Add `--baseline <report.json>` to reuse a saved scan. JSON reports now include stable finding fingerprints, the source revision, the comparison source, and the number of matched base findings. Gates and summary counts use only new findings.
