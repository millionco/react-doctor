---
"react-doctor": patch
---

Fix `--staged` false positive on git-ignored config files. Git-ignored config files (e.g. `.opencode/package.json`) can never be staged, so they should not block staged scans with divergence errors.
