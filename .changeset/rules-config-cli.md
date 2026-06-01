---
"react-doctor": patch
---

Add `react-doctor rules` commands to list, explain, and configure rules without hand-editing `react-doctor.config.json`.

`rules list` shows every rule and the severity it runs at under your config; `rules explain <rule>` describes why a rule matters, its current severity, and how to tune it; and `rules set` / `enable` / `disable` / `category` / `ignore-tag` / `unignore-tag` edit the config for you — preserving your other settings and stamping `$schema`. Rule references accept the full key (`react-doctor/no-danger`), the bare id (`no-danger`), or a legacy key (`react/no-danger`).

Also ships a `doctor-explain` skill (alias `doctor-config`) via `react-doctor install` that teaches coding agents to explain a rule before disabling it and to pick the narrowest control (rule severity vs category vs tag vs `surfaces`).
