---
"react-doctor": patch
---

Fold the standalone `doctor-explain` skill into the `react-doctor` skill as `references/explain.md`.

Rule-explanation and config-tuning guidance now ships as an on-demand reference inside the primary skill (per the agentskills.io `references/` convention) instead of a separate sibling skill. `react-doctor install` installs a single skill, and the dead bundled-sibling-skill install machinery is removed.
