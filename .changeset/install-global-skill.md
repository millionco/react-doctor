---
"react-doctor": patch
---

Add `--global` to `react-doctor install` (and an interactive "Where should the skill be installed?" prompt): install the `/react-doctor` skill into each agent's home directory (`~/.cursor`, `~/.claude`, …) so it applies to every project, instead of only this repo's local agent dirs. The default stays project-local; `--global` opts in, and non-interactive runs (`--yes`) remain local unless `--global` is passed.
