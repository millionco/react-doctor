---
"react-doctor": patch
---

Harden package execution by replacing `@latest` with a bounded version range.

**Changed:**

- Skill files now use `react-doctor@0.x` instead of `@latest`
- CLI-generated commands use `@0.x` in install scripts, git hooks, and CI configs
- GitHub Action defaults to `0.x` when no version is specified
- Package spec resolver maps `latest` to `0.x` for backward compatibility
