---
"react-doctor": minor
---

Configure React Doctor with `doctor.config.{ts,js,mjs,cjs,mts,cts,json}` (or a `package.json#reactDoctor` key), and add `react-doctor rules` commands to list, explain, and configure rules without hand-editing config.

- **TS-first config.** Author `doctor.config.ts` (or any JS/JSON variant) — TypeScript and ESM configs load via `jiti`, and JSON configs allow comments and trailing commas (JSONC).
- **`rules` commands.** `rules list` shows every rule and the severity it runs at; `rules explain <rule>` describes why a rule matters and how to tune it; and `rules set` / `enable` / `disable` / `category` / `ignore-tag` / `unignore-tag` edit your config for you. TS/JS configs are edited in place via `magicast` (formatting and comments preserved); JSON and `package.json` are edited as data; a `doctor.config.json` is created when no config exists. Rule references accept the full key (`react-doctor/no-danger`), the bare id (`no-danger`), or a legacy key (`react/no-danger`).
- **`doctor-explain` skill** (alias `doctor-config`), shipped via `react-doctor install`, teaches coding agents to explain a rule before disabling it and to pick the narrowest control (rule severity vs category vs tag vs `surfaces`).

**Breaking:** the config file is now `doctor.config.*` instead of `react-doctor.config.json`. Rename your `react-doctor.config.json` to `doctor.config.json` (a warning points this out if the old file is found). The `package.json#reactDoctor` key is unchanged.
