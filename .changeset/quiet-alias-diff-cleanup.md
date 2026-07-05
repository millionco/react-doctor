---
"react-doctor": patch
---

Fix several cleanup/audit findings: `diagnose(..., { lint: false })` now skips the lint layer as documented, legacy and bare rule aliases work in `ignore.overrides` and `surfaces.*Rules`, branch diff scopes ignore unrelated dirty working-tree edits, prefilled error issue URLs scrub sensitive paths/tokens, and shipped docs/skills no longer point at stale dead-code or `--diff` guidance.
