---
"react-doctor": patch
---

Align `react-doctor install`'s agent selection with the Vercel `skills` CLI so it stops scattering skill directories across your project. The prompt previously detected every agent with a config dir anywhere in `$HOME` (`~/.codebuddy`, `~/.crush`, `~/.goose`, `~/.kilocode`, …) and **pre-selected all of them**, so a single Enter copied `.codebuddy/`, `.crush/`, `.goose/`, … into the project root.

Now, following that CLI's heuristic, the default selection is:

- your **remembered** last pick (persisted globally, like `skills`' `lastSelectedAgents` lock), else
- a small curated set of popular agents (`claude-code`, `cursor`, `codex`, `opencode`), else
- a lone detected agent when that's the only one — and otherwise nothing, so you make a deliberate choice.

Every detected agent is still shown so the rest are one keystroke away; they're just no longer pre-checked. A non-interactive run (`--yes` / CI) still installs to all detected agents, matching `skills`' `--yes`.
