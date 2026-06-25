---
"react-doctor": patch
---

Make agent hooks cross-platform by using Node.js scripts instead of shell scripts. Cursor and Claude Code agent hooks now work on Windows without requiring Git Bash, WSL, or Cygwin. Hook scripts are now `.mjs` files invoked via `node` instead of `.sh` files invoked via `sh`, making them natively runnable on all platforms where Node.js is available.
