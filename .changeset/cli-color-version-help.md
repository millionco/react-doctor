---
"react-doctor": minor
---

Align the CLI with the clig.dev and 12-factor CLI guidelines:

- `--color` / `--no-color` flags force or disable colored output, with app-specific `REACT_DOCTOR_NO_COLOR` / `REACT_DOCTOR_FORCE_COLOR` env overrides. Flags win over env vars, which win over picocolors' built-in `NO_COLOR` / `FORCE_COLOR` / `TERM` / TTY detection; the preference is resolved before parsing so it reaches every surface (scan report, branded header, score, prompts, errors).
- `react-doctor --help` and `react-doctor install --help` now lead with worked examples and link to where to report feedback.
- New `react-doctor version` subcommand prints the version with Node and platform info (e.g. `react-doctor/0.2.14 darwin-arm64 node-v24.14.0`); `-v` / `-V` / `--version` stay terse for scripts.
- `react-doctor help` and `react-doctor help <command>` now show help instead of failing by trying to scan a directory named "help".
