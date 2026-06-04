---
"react-doctor": patch
---

`react-doctor --full --yes` no longer errors with "Cannot combine --yes and --full; pick one."

`--yes` (skip prompts, scan all workspace projects) and `--full` (force a full scan, overriding any `diff` value) control orthogonal concerns, so combining them is a valid request — "scan every workspace project fully, without prompting." The mutual-exclusion check that rejected the pair has been removed.
