---
"react-doctor": patch
---

Fix `react-doctor install` crashes on pre-existing malformed/conflicting agent config. The install command now handles three user-environment failure modes gracefully with clear error messages instead of unhandled exceptions:

1. Malformed JSON in `~/.claude/settings.json` or `~/.cursor/hooks.json` (REACT-DOCTOR-25)
2. Directory path blocked by an existing file at `~/.claude/skills` or parent paths (REACT-DOCTOR-17)
3. Permission denied when target directories aren't writable (REACT-DOCTOR-1A)

These errors are now treated as expected user-environment conditions (not react-doctor bugs) and surface actionable messages without Sentry reports.
