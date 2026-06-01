---
"react-doctor": minor
---

Configure React Doctor with `doctor.config.{ts,js,mjs,cjs,mts,cts,json}` (or a `package.json#reactDoctor` key), and add `react-doctor rules` commands to list, explain, and configure rules without hand-editing config.

- **TS-first config.** Author `doctor.config.ts` (or any JS/JSON variant) — TypeScript and ESM configs load via `jiti`, and JSON configs allow comments and trailing commas (JSONC).
- **`rules` commands.** `rules list` shows every rule and the severity it runs at; `rules explain <rule>` describes why a rule matters and how to tune it; and `rules set` / `enable` / `disable` / `category` / `ignore-tag` / `unignore-tag` edit your config for you. TS/JS configs are edited in place via `magicast` (formatting and comments preserved); JSON and `package.json` are edited as data; a `doctor.config.json` is created when no config exists. Rule references accept the full key (`react-doctor/no-danger`), the bare id (`no-danger`), or a legacy key (`react/no-danger`).
- **`doctor-explain` skill** (alias `doctor-config`), shipped via `react-doctor install`, teaches coding agents to explain a rule before disabling it and to pick the narrowest control (rule severity vs category vs tag vs `surfaces`).

**Breaking:** the config file is now `doctor.config.*` instead of `react-doctor.config.json`. The next time you run `react-doctor` interactively, an existing `react-doctor.config.json` is automatically migrated to a typed `doctor.config.ts` (settings preserved, `$schema` dropped) and you're told once — CI, coding-agent, `--staged`, JSON/score, and non-TTY runs are left untouched (a warning still nudges them). The `package.json#reactDoctor` key is unchanged.
