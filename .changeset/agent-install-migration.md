---
"react-doctor": patch
---

`react-doctor install` now delegates skill installation to
[`agent-install`](https://www.npmjs.com/package/agent-install) `0.0.4`,
which natively models **54 supported coding agents** (up from the 8 we
previously hand-rolled).

Behavior changes:

- **Detection** is now the union of CLI binaries on `$PATH` (the previous
  signal) and config dirs in `$HOME` (`~/.claude`, `~/.cursor`,
  `~/.codex`, `~/.factory`, `~/.pi`, etc.). This catches agents the user
  has run at least once even if the CLI is no longer on `$PATH`, and vice
  versa.
- **All 8 originally documented agents stay supported**: Claude Code,
  Codex, Cursor, Factory Droid, Gemini CLI, GitHub Copilot, OpenCode, Pi.
- **46 newly supported agents** via upstream `agent-install@0.0.4`:
  Goose, Windsurf, Roo Code, Cline, Kilo Code, Warp, Replit, OpenHands,
  Qwen Code, Continue, Aider Desk, Augment, Cortex, Devin, Junie, Kiro
  CLI, Crush, Mux, Pochi, Qoder, Trae, Zencoder, and many more.
- **Bug fix**: malformed `SKILL.md` frontmatter now surfaces as an error
  instead of a silent "installed for ..." success with zero files
  written. Build-time validation in `vite.config.ts` also catches this
  before publish.
