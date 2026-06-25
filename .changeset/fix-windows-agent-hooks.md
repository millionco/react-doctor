---
"react-doctor": patch
---

Install agent hooks (Cursor, Claude Code) as a Node `.mjs` runner invoked via `node` instead of a `#!/bin/sh` script, so they run on Windows without Git Bash/WSL/Cygwin. Closes #965.
