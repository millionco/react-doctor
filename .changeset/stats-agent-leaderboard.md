---
"react-doctor": patch
---

Add a `react-doctor stats` subcommand — a per-model code-quality leaderboard built from local AI agent chat history.

`stats` reads local agent history — Claude Code (`~/.claude`) and Codex (`~/.codex`) transcripts, plus the Cursor composer database — reconstructs the file content each model actually wrote (Claude post-edit snapshots, Cursor full post-edit file snapshots, Codex `apply_patch` envelopes), lints that content with the existing engine, and ranks models and providers by their React Doctor score and diagnostics-per-file. The job: answer "which agent/model writes the cleanest React code in my repo".

- Only the React code each model wrote is scored. Reconstructed files are filtered to actual React (JSX/TSX, `use client`/`use server` directives, or a React-ecosystem import) before linting, so a model's plain backend/util/config files don't pad its file count or dilute its diagnostics-per-file. A scan that errors, is skipped, or whose lint phase fails is dropped rather than counted as zero-diagnostic "clean" code, so un-lintable output can't inflate a model's score.
- Ranking is by a confidence-weighted score, not the raw score: each group's score is regressed toward the global mean by its evidence, so a model with a handful of clean files can't top the board on a tiny sample. Files are the dominant signal; sessions only lightly discount the file weight (many files from one session are one correlated sample) and never below a floor.
- Cursor attribution reads the canonical composer database (`state.vscdb`) directly, so each session carries its real model (e.g. `claude-opus-4-8`, `gpt-5.5`, `composer-2`) and an exact post-edit snapshot of every edited file — the model-less agent-transcript JSONL files are no longer used. Attribution falls back to `unknown` only for chats left on the "Auto" model.
- Default scope is the current repository (sessions whose cwd or edits touch the repo root); `--global` ranks across every repo on the machine. `--since`, `--limit`, and `--provider` bound the work.
- `--json` emits a structured leaderboard (`{ schemaVersion, scope, models, providers, best, worst, … }`); the terminal output shows the top models and per-tool tables with a single score bar (the confidence-weighted score) and a best/worst callout.
- Coverage is honest about its limits: Codex shell-based edits are not faithfully reconstructable (surfaced as skipped), the Cursor composer database requires `node:sqlite` (Node 22.13+) and covers GUI agent sessions (not cursor-agent CLI runs), and the score requires network access.
