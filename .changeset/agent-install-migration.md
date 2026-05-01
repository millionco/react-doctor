---
"react-doctor": patch
---

`react-doctor install` now delegates skill installation to
[`agent-install`](https://www.npmjs.com/package/agent-install) `0.0.3`,
which natively models all 13 supported coding agents (including Factory
Droid and Pi).

Behavior changes:

- **Detection** is now the union of CLI binaries on `$PATH` (the previous
  signal) and config dirs in `$HOME` (`~/.claude`, `~/.cursor`,
  `~/.codex`, `~/.factory`, `~/.pi`, etc.). This catches agents the user
  has run at least once even if the CLI is no longer on `$PATH`, and vice
  versa.
- **New supported agents**: Goose, Windsurf, Roo Code, Cline, Kilo Code
  (in addition to Claude Code, Codex, Cursor, Factory Droid, Gemini CLI,
  GitHub Copilot, OpenCode, Pi).
- **Bug fix**: malformed `SKILL.md` frontmatter now surfaces as an error
  instead of a silent "installed for ..." success with zero files
  written. Build-time validation in `vite.config.ts` also catches this
  before publish.
